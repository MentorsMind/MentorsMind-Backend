/**
 * Region-Aware Routing Service
 *
 * Manages request routing to optimal regions based on:
 * - User location
 * - Region health status
 * - Traffic weights and load balancing
 * - Session affinity and sticky sessions
 */

import { EventEmitter } from "events";
import regionConfig, {
  getRegionConfig,
  getPrimaryRegionConfig,
  getActiveRegionConfigs,
  getLatencyBasedWeights,
  findClosestRegion,
} from "../config/region.config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegionRoute {
  regionId: string;
  endpoint: string;
  isHealthy: boolean;
  latency: number;
  priority: number;
}

export interface RoutingContext {
  userId?: string;
  userLatitude?: number;
  userLongitude?: number;
  forceRegion?: string; // Override region selection
  sessionId?: string;
}

export interface RoutingDecision {
  regionId: string;
  endpoint: string;
  isDegraded: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Region Health Status
// ---------------------------------------------------------------------------

interface RegionHealthStatus {
  regionId: string;
  healthy: boolean;
  lastCheckTime: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  latency: number;
  responseTime: number;
}

class RegionHealthMonitor extends EventEmitter {
  private healthStatus: Map<string, RegionHealthStatus> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor() {
    super();
    this.initializeHealthStatus();
    this.startHealthChecks();
  }

  private initializeHealthStatus() {
    const configs = getActiveRegionConfigs();
    for (const config of configs) {
      this.healthStatus.set(config.id, {
        regionId: config.id,
        healthy: true,
        lastCheckTime: Date.now(),
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        latency: 0,
        responseTime: 0,
      });

      this.circuitBreakers.set(config.id, new CircuitBreaker());
    }
  }

  private startHealthChecks() {
    const checkInterval = regionConfig.failover.healthCheckIntervalMs;
    setInterval(() => this.performHealthChecks(), checkInterval);
  }

  private async performHealthChecks() {
    const configs = getActiveRegionConfigs();

    for (const config of configs) {
      const status = this.healthStatus.get(config.id)!;
      const breaker = this.circuitBreakers.get(config.id)!;

      // Skip if circuit breaker is open
      if (breaker.isOpen() && !breaker.canTest()) {
        continue;
      }

      try {
        const startTime = Date.now();
        const response = await this.checkRegionHealth(config.id, config);
        const responseTime = Date.now() - startTime;

        status.latency = responseTime;
        status.responseTime = responseTime;
        status.lastCheckTime = Date.now();

        if (response.healthy) {
          status.consecutiveSuccesses++;
          status.consecutiveFailures = 0;

          if (
            status.consecutiveSuccesses >=
            config.healthCheck.healthyThreshold
          ) {
            status.healthy = true;
            breaker.reset();
            this.emit("region:healthy", config.id);
          }
        } else {
          status.consecutiveFailures++;
          status.consecutiveSuccesses = 0;

          if (
            status.consecutiveFailures >=
            config.healthCheck.unhealthyThreshold
          ) {
            status.healthy = false;
            breaker.open();
            this.emit("region:unhealthy", config.id);
          }
        }
      } catch (error) {
        status.consecutiveFailures++;
        status.consecutiveSuccesses = 0;

        if (
          status.consecutiveFailures >= config.healthCheck.unhealthyThreshold
        ) {
          status.healthy = false;
          breaker.open();
          this.emit("region:unhealthy", config.id);
        }
      }
    }
  }

  private async checkRegionHealth(
    regionId: string,
    config: any
  ): Promise<{ healthy: boolean }> {
    const timeoutMs = config.healthCheck.timeoutMs;
    const endpoint = config.healthCheck.endpoint;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(
        `http://${config.database.host}:3000${endpoint}`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      return {
        healthy: response.status >= 200 && response.status < 300,
      };
    } catch (error) {
      return { healthy: false };
    }
  }

  getHealthStatus(regionId: string): RegionHealthStatus | undefined {
    return this.healthStatus.get(regionId);
  }

  isRegionHealthy(regionId: string): boolean {
    const status = this.healthStatus.get(regionId);
    return status?.healthy ?? false;
  }

  getAllHealthStatus(): RegionHealthStatus[] {
    return Array.from(this.healthStatus.values());
  }
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

class CircuitBreaker {
  private state: "closed" | "open" | "half-open" = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  isOpen(): boolean {
    if (this.state === "open") {
      const resetTimeout = regionConfig.circuitBreaker.resetTimeoutMs;
      if (Date.now() - this.lastFailureTime > resetTimeout) {
        this.state = "half-open";
        this.successCount = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  canTest(): boolean {
    return this.state === "half-open";
  }

  recordSuccess() {
    this.failureCount = 0;
    this.successCount++;
    if (this.state === "half-open" && this.successCount >= 2) {
      this.reset();
    }
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= regionConfig.circuitBreaker.failureThreshold) {
      this.state = "open";
    }
  }

  reset() {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
  }
}

// ---------------------------------------------------------------------------
// Session Affinity Manager
// ---------------------------------------------------------------------------

class SessionAffinityManager {
  private sessionRegionMap: Map<string, { region: string; expiresAt: number }> =
    new Map();

  assignRegion(sessionId: string, regionId: string): void {
    const { affinityTimeoutMs } = getRegionConfig(regionId)!.routing;
    this.sessionRegionMap.set(sessionId, {
      region: regionId,
      expiresAt: Date.now() + affinityTimeoutMs,
    });
  }

  getRegion(sessionId: string): string | null {
    const entry = this.sessionRegionMap.get(sessionId);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.sessionRegionMap.delete(sessionId);
      return null;
    }

    return entry.region;
  }

  clearExpired(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.sessionRegionMap.entries()) {
      if (now > entry.expiresAt) {
        this.sessionRegionMap.delete(sessionId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Region Routing Service
// ---------------------------------------------------------------------------

class RegionRoutingService extends EventEmitter {
  private healthMonitor: RegionHealthMonitor;
  private affinityManager: SessionAffinityManager;

  constructor() {
    super();
    this.healthMonitor = new RegionHealthMonitor();
    this.affinityManager = new SessionAffinityManager();

    // Cleanup expired affinity entries periodically
    setInterval(() => this.affinityManager.clearExpired(), 60000);

    // Forward health events
    this.healthMonitor.on("region:healthy", (regionId) => {
      this.emit("region:recovered", regionId);
    });

    this.healthMonitor.on("region:unhealthy", (regionId) => {
      this.emit("region:failed", regionId);
    });
  }

  /**
   * Determine optimal region for routing
   */
  async getOptimalRegion(context: RoutingContext): Promise<RoutingDecision> {
    // Override if specified
    if (regionConfig.failover.overrideRegion) {
      return this.createRoutingDecision(
        regionConfig.failover.overrideRegion,
        "Override region active"
      );
    }

    // Check session affinity
    if (context.sessionId) {
      const affinityRegion = this.affinityManager.getRegion(context.sessionId);
      if (affinityRegion && this.healthMonitor.isRegionHealthy(affinityRegion)) {
        return this.createRoutingDecision(
          affinityRegion,
          "Session affinity maintained"
        );
      }
    }

    // Force specific region if provided
    if (context.forceRegion) {
      const config = getRegionConfig(context.forceRegion);
      if (config && this.healthMonitor.isRegionHealthy(context.forceRegion)) {
        return this.createRoutingDecision(context.forceRegion, "Forced region");
      }
    }

    // Use geographic proximity if available
    if (
      context.userLatitude !== undefined &&
      context.userLongitude !== undefined
    ) {
      const closest = findClosestRegion(
        context.userLatitude,
        context.userLongitude
      );
      if (this.healthMonitor.isRegionHealthy(closest.id)) {
        return this.createRoutingDecision(
          closest.id,
          "Geographic proximity routing"
        );
      }
    }

    // Fall back to latency-weighted routing
    const weights = getLatencyBasedWeights({}); // Default equal latency
    const selected = this.selectByWeights(weights);

    if (context.sessionId) {
      this.affinityManager.assignRegion(context.sessionId, selected);
    }

    return this.createRoutingDecision(selected, "Latency-weighted routing");
  }

  /**
   * Get available routes for failover
   */
  getFailoverRoutes(primaryRegionId: string): RegionRoute[] {
    const primaryConfig = getRegionConfig(primaryRegionId);
    if (!primaryConfig) return [];

    const routes: RegionRoute[] = [];

    // Add secondary regions in order
    for (const secondaryId of primaryConfig.failover.secondaryRegions) {
      const config = getRegionConfig(secondaryId);
      if (!config) continue;

      const status = this.healthMonitor.getHealthStatus(secondaryId);
      if (status) {
        routes.push({
          regionId: secondaryId,
          endpoint: `http://${config.database.host}:3000`,
          isHealthy: status.healthy,
          latency: status.latency,
          priority: routes.length + 1,
        });
      }
    }

    return routes;
  }

  /**
   * Get all region status information
   */
  getRegionStatus(): RegionHealthStatus[] {
    return this.healthMonitor.getAllHealthStatus();
  }

  /**
   * Perform manual failover to specific region
   */
  async manualFailover(newPrimaryRegion: string): Promise<boolean> {
    if (!this.healthMonitor.isRegionHealthy(newPrimaryRegion)) {
      this.emit("failover:failed", {
        reason: "Target region is not healthy",
        regionId: newPrimaryRegion,
      });
      return false;
    }

    this.emit("failover:initiated", {
      newPrimary: newPrimaryRegion,
      timestamp: Date.now(),
    });

    return true;
  }

  private selectByWeights(weights: Record<string, number>): string {
    const random = Math.random() * 100;
    let cumulative = 0;

    for (const regionId of Object.keys(weights).sort()) {
      cumulative += weights[regionId];
      if (random <= cumulative) {
        return regionId;
      }
    }

    // Fallback to primary region
    return regionConfig.primaryRegion;
  }

  private createRoutingDecision(
    regionId: string,
    reason: string
  ): RoutingDecision {
    const config = getRegionConfig(regionId);
    const isHealthy = this.healthMonitor.isRegionHealthy(regionId);

    if (!config) {
      const primary = getPrimaryRegionConfig();
      return {
        regionId: primary.id,
        endpoint: `http://${primary.database.host}:3000`,
        isDegraded: true,
        reason: "Region not found, using primary",
      };
    }

    return {
      regionId,
      endpoint: `http://${config.database.host}:3000`,
      isDegraded: !isHealthy,
      reason,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton Instance
// ---------------------------------------------------------------------------

let routingService: RegionRoutingService | null = null;

export function getRegionRoutingService(): RegionRoutingService {
  if (!routingService) {
    routingService = new RegionRoutingService();
  }
  return routingService;
}

export { RegionRoutingService, RegionHealthMonitor, SessionAffinityManager };
export type { RegionRoute, RoutingContext, RoutingDecision, RegionHealthStatus };
