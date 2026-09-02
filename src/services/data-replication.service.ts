/**
 * Data Replication Service
 *
 * Manages cross-region data replication with support for:
 * - Async, sync, and semi-sync replication strategies
 * - Replication lag monitoring
 * - Conflict resolution
 * - Retry policies and circuit breakers
 */

import { EventEmitter } from "events";
import regionConfig, {
  getRegionConfig,
  getPrimaryRegionConfig,
  getActiveRegionConfigs,
} from "../config/region.config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplicationEvent {
  id: string;
  sourceRegion: string;
  targetRegion: string;
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  timestamp: number;
  data: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface ReplicationStatus {
  regionId: string;
  lagMs: number;
  isBehind: boolean;
  lastReplicationTime: number;
  pendingEvents: number;
  failureCount: number;
}

export interface ReplicationConfig {
  strategy: "async" | "sync" | "semi-sync";
  targetLagMs: number;
  retryPolicy: {
    maxAttempts: number;
    backoffMs: number;
    maxBackoffMs: number;
  };
}

// ---------------------------------------------------------------------------
// Replication Event Queue
// ---------------------------------------------------------------------------

class ReplicationEventQueue extends EventEmitter {
  private queue: ReplicationEvent[] = [];
  private processing = false;
  private maxQueueSize = 10000;

  enqueue(event: ReplicationEvent): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.emit("queue:full", {
        regionId: event.targetRegion,
        queueSize: this.queue.length,
      });
      return;
    }

    this.queue.push(event);
    this.emit("event:queued", event);

    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (event) {
        await this.processEvent(event);
      }
    }

    this.processing = false;
  }

  private async processEvent(event: ReplicationEvent): Promise<void> {
    this.emit("event:processing", event);
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getQueue(): ReplicationEvent[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
  }
}

// ---------------------------------------------------------------------------
// Replication Lag Monitor
// ---------------------------------------------------------------------------

class ReplicationLagMonitor extends EventEmitter {
  private lagStatus: Map<string, ReplicationStatus> = new Map();
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.initializeStatus();
  }

  private initializeStatus(): void {
    const configs = getActiveRegionConfigs();
    for (const config of configs) {
      if (!config.isPrimary) {
        this.lagStatus.set(config.id, {
          regionId: config.id,
          lagMs: 0,
          isBehind: false,
          lastReplicationTime: Date.now(),
          pendingEvents: 0,
          failureCount: 0,
        });
      }
    }
  }

  /**
   * Start monitoring replication lag
   */
  startMonitoring(): void {
    if (this.monitorInterval) return;

    const checkInterval = regionConfig.failover.healthCheckIntervalMs;
    this.monitorInterval = setInterval(() => this.checkLag(), checkInterval);
  }

  /**
   * Stop monitoring replication lag
   */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  private async checkLag(): Promise<void> {
    for (const [regionId, status] of this.lagStatus.entries()) {
      try {
        const config = getRegionConfig(regionId);
        if (!config) continue;

        // Simulate lag check (in production, would query replication status)
        const simulatedLag = Math.random() * 100; // 0-100ms
        const wasBehand = status.isBehind;

        status.lagMs = simulatedLag;
        status.isBehind =
          simulatedLag > config.replication.targetLagMs;
        status.lastReplicationTime = Date.now();

        if (wasBehand && !status.isBehind) {
          this.emit("lag:recovered", regionId);
        } else if (!wasBehand && status.isBehind) {
          this.emit("lag:degraded", regionId);
        }
      } catch (error) {
        const status = this.lagStatus.get(regionId);
        if (status) {
          status.failureCount++;
        }
      }
    }
  }

  getStatus(regionId: string): ReplicationStatus | undefined {
    return this.lagStatus.get(regionId);
  }

  getAllStatus(): ReplicationStatus[] {
    return Array.from(this.lagStatus.values());
  }

  updateLag(regionId: string, lagMs: number): void {
    const status = this.lagStatus.get(regionId);
    if (status) {
      const config = getRegionConfig(regionId);
      const wasBehind = status.isBehind;

      status.lagMs = lagMs;
      status.isBehind = config
        ? lagMs > config.replication.targetLagMs
        : false;
      status.lastReplicationTime = Date.now();

      if (wasBehind && !status.isBehind) {
        this.emit("lag:recovered", regionId);
      } else if (!wasBehind && status.isBehind) {
        this.emit("lag:degraded", regionId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Replication Strategy Executor
// ---------------------------------------------------------------------------

class ReplicationStrategyExecutor {
  private eventQueue: ReplicationEventQueue;
  private lagMonitor: ReplicationLagMonitor;

  constructor() {
    this.eventQueue = new ReplicationEventQueue();
    this.lagMonitor = new ReplicationLagMonitor();
    this.lagMonitor.startMonitoring();
  }

  /**
   * Execute replication based on configured strategy
   */
  async replicate(
    event: ReplicationEvent,
    strategy: "async" | "sync" | "semi-sync"
  ): Promise<void> {
    switch (strategy) {
      case "async":
        return this.asyncReplication(event);
      case "sync":
        return this.syncReplication(event);
      case "semi-sync":
        return this.semiSyncReplication(event);
      default:
        throw new Error(`Unknown replication strategy: ${strategy}`);
    }
  }

  /**
   * Asynchronous replication - queue and return immediately
   */
  private async asyncReplication(event: ReplicationEvent): Promise<void> {
    this.eventQueue.enqueue(event);
  }

  /**
   * Synchronous replication - wait for all replicas to confirm
   */
  private async syncReplication(event: ReplicationEvent): Promise<void> {
    const targetConfig = getRegionConfig(event.targetRegion);
    if (!targetConfig) {
      throw new Error(`Target region not found: ${event.targetRegion}`);
    }

    const replicaHosts = targetConfig.database.replicas.map((r) => r.host);
    const promises = replicaHosts.map((host) =>
      this.sendReplication(host, event)
    );

    await Promise.all(promises);
  }

  /**
   * Semi-synchronous replication - wait for at least one replica
   */
  private async semiSyncReplication(event: ReplicationEvent): Promise<void> {
    const targetConfig = getRegionConfig(event.targetRegion);
    if (!targetConfig) {
      throw new Error(`Target region not found: ${event.targetRegion}`);
    }

    const replicaHosts = targetConfig.database.replicas.map((r) => r.host);
    const promises = replicaHosts.map((host) =>
      this.sendReplication(host, event)
    );

    // Wait for at least one to succeed
    await Promise.race(promises);

    // Queue remaining for async processing
    this.eventQueue.enqueue(event);
  }

  private async sendReplication(
    host: string,
    event: ReplicationEvent
  ): Promise<void> {
    // Simulate sending replication event
    // In production, would use database replication protocol
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        Math.random() > 0.1 ? resolve() : reject(new Error("Replication failed"));
      }, 10);
    });
  }

  getEventQueue(): ReplicationEventQueue {
    return this.eventQueue;
  }

  getLagMonitor(): ReplicationLagMonitor {
    return this.lagMonitor;
  }
}

// ---------------------------------------------------------------------------
// Conflict Resolution
// ---------------------------------------------------------------------------

class ConflictResolver {
  /**
   * Resolve conflicts using last-write-wins strategy
   */
  static lastWriteWins(
    localData: any,
    remoteData: any,
    localTimestamp: number,
    remoteTimestamp: number
  ): any {
    return remoteTimestamp > localTimestamp ? remoteData : localData;
  }

  /**
   * Resolve conflicts using merge strategy
   */
  static merge(localData: any, remoteData: any): any {
    return {
      ...localData,
      ...remoteData,
      _merged: true,
    };
  }

  /**
   * Resolve conflicts using custom function
   */
  static custom(
    resolver: (local: any, remote: any) => any,
    localData: any,
    remoteData: any
  ): any {
    return resolver(localData, remoteData);
  }
}

// ---------------------------------------------------------------------------
// Data Replication Service
// ---------------------------------------------------------------------------

class DataReplicationService extends EventEmitter {
  private executor: ReplicationStrategyExecutor;
  private conflictResolver = ConflictResolver;
  private replicationStatus: Map<string, ReplicationStatus> = new Map();

  constructor() {
    super();
    this.executor = new ReplicationStrategyExecutor();

    // Forward lag monitor events
    this.executor.getLagMonitor().on("lag:recovered", (regionId) => {
      this.emit("replication:recovered", regionId);
    });

    this.executor.getLagMonitor().on("lag:degraded", (regionId) => {
      this.emit("replication:degraded", regionId);
    });
  }

  /**
   * Queue replication event for a data change
   */
  async queueReplication(
    table: string,
    operation: "INSERT" | "UPDATE" | "DELETE",
    data: Record<string, any>
  ): Promise<void> {
    const sourceRegion = regionConfig.primaryRegion;

    for (const targetRegionId of regionConfig.activeRegions) {
      if (targetRegionId === sourceRegion) continue;
      if (!regionConfig.replication.enabled) continue;

      const event: ReplicationEvent = {
        id: `${Date.now()}-${Math.random()}`,
        sourceRegion,
        targetRegion: targetRegionId,
        table,
        operation,
        timestamp: Date.now(),
        data,
      };

      const config = getRegionConfig(targetRegionId);
      if (config && config.replication) {
        await this.executor.replicate(event, config.replication.strategy);
      }
    }
  }

  /**
   * Get replication status for all regions
   */
  getReplicationStatus(): ReplicationStatus[] {
    return this.executor.getLagMonitor().getAllStatus();
  }

  /**
   * Get replication status for specific region
   */
  getRegionReplicationStatus(regionId: string): ReplicationStatus | undefined {
    return this.executor.getLagMonitor().getStatus(regionId);
  }

  /**
   * Update replication lag for a region
   */
  updateReplicationLag(regionId: string, lagMs: number): void {
    this.executor.getLagMonitor().updateLag(regionId, lagMs);
  }

  /**
   * Get pending replication events
   */
  getPendingEvents(): ReplicationEvent[] {
    return this.executor.getEventQueue().getQueue();
  }

  /**
   * Clear pending replication events
   */
  clearPendingEvents(): void {
    this.executor.getEventQueue().clear();
  }

  /**
   * Resolve conflicts between replicas
   */
  resolveConflict(
    localData: any,
    remoteData: any,
    strategy: "last-write-wins" | "merge" | "custom" = "last-write-wins",
    customResolver?: (local: any, remote: any) => any
  ): any {
    switch (strategy) {
      case "last-write-wins":
        return this.conflictResolver.lastWriteWins(
          localData,
          remoteData,
          localData._timestamp || 0,
          remoteData._timestamp || 0
        );
      case "merge":
        return this.conflictResolver.merge(localData, remoteData);
      case "custom":
        if (!customResolver) {
          throw new Error("Custom resolver required for custom strategy");
        }
        return this.conflictResolver.custom(customResolver, localData, remoteData);
      default:
        return localData;
    }
  }

  /**
   * Start replication monitoring
   */
  startMonitoring(): void {
    this.executor.getLagMonitor().startMonitoring();
  }

  /**
   * Stop replication monitoring
   */
  stopMonitoring(): void {
    this.executor.getLagMonitor().stopMonitoring();
  }
}

// ---------------------------------------------------------------------------
// Singleton Instance
// ---------------------------------------------------------------------------

let replicationService: DataReplicationService | null = null;

export function getDataReplicationService(): DataReplicationService {
  if (!replicationService) {
    replicationService = new DataReplicationService();
  }
  return replicationService;
}

export {
  DataReplicationService,
  ReplicationEventQueue,
  ReplicationLagMonitor,
  ReplicationStrategyExecutor,
  ConflictResolver,
};
export type {
  ReplicationEvent,
  ReplicationStatus,
  ReplicationConfig,
};
