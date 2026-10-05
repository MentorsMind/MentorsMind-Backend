/**
 * Connection Health Monitoring Service
 * Monitors connection health, validates connections, and triggers recovery
 */

import { EventEmitter } from 'events';
import { Logger } from "../utils/logger.utils";
import { PoolOptimizationConfig, ConnectionHealth } from '../config/pool-optimization';

export class ConnectionHealthService extends EventEmitter {
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private connectionHealthMap: Map<string, ConnectionHealth> = new Map();
  private logger: Logger;
  private config: PoolOptimizationConfig;

  constructor(config: PoolOptimizationConfig) {
    super();
    this.config = config;
    this.logger = new Logger('ConnectionHealthService');
  }

  /**
   * Start health monitoring
   */
  public start(): void {
    if (this.healthCheckInterval) {
      this.logger.warn('Health monitoring already started');
      return;
    }

    this.logger.info('Starting connection health monitoring');
    this.healthCheckInterval = setInterval(
      () => this.performHealthChecks(),
      this.config.healthCheckIntervalMs
    );
  }

  /**
   * Stop health monitoring
   */
  public stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      this.logger.info('Connection health monitoring stopped');
    }
  }

  /**
   * Register a connection for health monitoring
   */
  public registerConnection(connectionId: string): void {
    const health: ConnectionHealth = {
      connectionId,
      isHealthy: true,
      lastHealthCheck: Date.now(),
      consecutiveFailures: 0,
      age: 0,
      totalQueries: 0,
      lastActivity: Date.now(),
    };

    this.connectionHealthMap.set(connectionId, health);
    this.logger.debug(`Registered connection ${connectionId} for health monitoring`);
  }

  /**
   * Unregister a connection from health monitoring
   */
  public unregisterConnection(connectionId: string): void {
    this.connectionHealthMap.delete(connectionId);
    this.logger.debug(`Unregistered connection ${connectionId} from health monitoring`);
  }

  /**
   * Record connection activity
   */
  public recordActivity(connectionId: string): void {
    const health = this.connectionHealthMap.get(connectionId);
    if (health) {
      health.lastActivity = Date.now();
      health.totalQueries++;
    }
  }

  /**
   * Check if a connection is healthy
   */
  public async checkConnectionHealth(
    connectionId: string,
    validateFn: () => Promise<boolean>
  ): Promise<boolean> {
    const health = this.connectionHealthMap.get(connectionId);
    if (!health) {
      return false;
    }

    try {
      const isValid = await Promise.race([
        validateFn(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), this.config.healthCheckTimeoutMs)
        ),
      ]);

      if (isValid) {
        health.isHealthy = true;
        health.consecutiveFailures = 0;
        health.lastHealthCheck = Date.now();
        return true;
      } else {
        return this.handleUnhealthyConnection(connectionId, health);
      }
    } catch (error) {
      this.logger.error(`Health check failed for connection ${connectionId}:`, error);
      return this.handleUnhealthyConnection(connectionId, health);
    }
  }

  /**
   * Handle unhealthy connection
   */
  private handleUnhealthyConnection(connectionId: string, health: ConnectionHealth): boolean {
    health.consecutiveFailures++;
    health.lastHealthCheck = Date.now();

    if (health.consecutiveFailures >= this.config.failureThreshold) {
      health.isHealthy = false;
      this.logger.warn(
        `Connection ${connectionId} marked as unhealthy after ${health.consecutiveFailures} failures`
      );
      this.emit('connectionUnhealthy', connectionId);
      return false;
    }

    return true;
  }

  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    const now = Date.now();
    
    for (const [connectionId, health] of this.connectionHealthMap.entries()) {
      // Check connection age
      health.age = now - (health.lastHealthCheck - health.age);
      
      if (health.age > this.config.maxConnectionAge) {
        this.logger.info(`Connection ${connectionId} exceeded max age, marking for refresh`);
        this.emit('connectionAgeExceeded', connectionId);
      }

      // Check for stale connections
      const idleTime = now - health.lastActivity;
      if (idleTime > this.config.idleTimeoutMs * 2 && health.totalQueries === 0) {
        this.logger.info(`Connection ${connectionId} appears stale, marking for cleanup`);
        this.emit('connectionStale', connectionId);
      }
    }
  }

  /**
   * Get health status for a connection
   */
  public getConnectionHealth(connectionId: string): ConnectionHealth | undefined {
    return this.connectionHealthMap.get(connectionId);
  }

  /**
   * Get health statistics
   */
  public getHealthStatistics(): {
    totalConnections: number;
    healthyConnections: number;
    unhealthyConnections: number;
    averageAge: number;
    averageQueries: number;
  } {
    const connections = Array.from(this.connectionHealthMap.values());
    const healthyCount = connections.filter((c) => c.isHealthy).length;
    const totalAge = connections.reduce((sum, c) => sum + c.age, 0);
    const totalQueries = connections.reduce((sum, c) => sum + c.totalQueries, 0);

    return {
      totalConnections: connections.length,
      healthyConnections: healthyCount,
      unhealthyConnections: connections.length - healthyCount,
      averageAge: connections.length > 0 ? totalAge / connections.length : 0,
      averageQueries: connections.length > 0 ? totalQueries / connections.length : 0,
    };
  }
}
