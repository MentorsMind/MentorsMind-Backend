/**
 * Intelligent Connection Pool Manager
 * Manages adaptive pool sizing, health monitoring, failover, and leak detection
 */

import { EventEmitter } from 'events';
import { Logger } from "../utils/logger.utils";
import { PoolOptimizationConfig, PoolMetrics, defaultPoolConfig } from '../config/pool-optimization';
import { ConnectionHealthService } from './connection-health.service';

interface PoolConnection {
  id: string;
  connection: any;
  inUse: boolean;
  acquiredAt: number | null;
  createdAt: number;
}

export class ConnectionPoolManager extends EventEmitter {
  private pool: PoolConnection[] = [];
  private waitQueue: Array<{ resolve: (conn: any) => void; reject: (err: Error) => void; timestamp: number }> = [];
  private config: PoolOptimizationConfig;
  private healthService: ConnectionHealthService;
  private metrics: PoolMetrics[] = [];
  private logger: Logger;
  private evaluationInterval: NodeJS.Timeout | null = null;
  private isCircuitOpen = false;
  private circuitOpenedAt: number | null = null;
  private consecutiveFailures = 0;

  constructor(
    private connectionFactory: () => Promise<any>,
    config: Partial<PoolOptimizationConfig> = {}
  ) {
    super();
    this.config = { ...defaultPoolConfig, ...config };
    this.healthService = new ConnectionHealthService(this.config);
    this.logger = new Logger('ConnectionPoolManager');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    this.logger.info('Initializing connection pool manager');
    
    // Create minimum connections
    for (let i = 0; i < this.config.minConnections; i++) {
      try {
        await this.createConnection();
      } catch (error) {
        this.logger.error('Failed to create initial connection:', error);
      }
    }

    // Start health monitoring
    this.healthService.start();
    
    // Setup event listeners
    this.setupHealthServiceListeners();

    // Start adaptive sizing if enabled
    if (this.config.enableAdaptiveSizing) {
      this.startAdaptiveSizing();
    }

    this.logger.info(`Pool initialized with ${this.pool.length} connections`);
  }

  private async createConnection(): Promise<PoolConnection> {
    const id = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const connection = await this.connectionFactory();
    
    const poolConn: PoolConnection = {
      id,
      connection,
      inUse: false,
      acquiredAt: null,
      createdAt: Date.now(),
    };

    this.pool.push(poolConn);
    this.healthService.registerConnection(id);
    
    this.logger.debug(`Created connection ${id}`);
    return poolConn;
  }

  public async acquire(): Promise<any> {
    // Check circuit breaker
    if (this.isCircuitOpen) {
      const now = Date.now();
      if (this.circuitOpenedAt && now - this.circuitOpenedAt > this.config.circuitBreakerResetTimeMs) {
        this.logger.info('Circuit breaker reset, attempting to close');
        this.isCircuitOpen = false;
        this.consecutiveFailures = 0;
      } else {
        throw new Error('Circuit breaker is open - too many connection failures');
      }
    }

    // Try to get available connection
    const available = this.pool.find((conn) => !conn.inUse);
    
    if (available) {
      return this.acquireConnection(available);
    }

    // Try to create new connection if below max
    if (this.pool.length < this.config.maxConnections) {
      try {
        const newConn = await this.createConnection();
        return this.acquireConnection(newConn);
      } catch (error) {
        this.handleConnectionFailure(error);
        throw error;
      }
    }

    // Wait in queue
    return this.waitForConnection();
  }

  private acquireConnection(poolConn: PoolConnection): any {
    poolConn.inUse = true;
    poolConn.acquiredAt = Date.now();
    
    // Check for connection leaks
    if (this.config.enableLeakDetection) {
      this.scheduleLeakCheck(poolConn);
    }

    return poolConn.connection;
  }

  private waitForConnection(): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error('Connection acquisition timeout'));
      }, this.config.connectionTimeoutMs);

      this.waitQueue.push({
        resolve: (conn) => {
          clearTimeout(timeout);
          resolve(conn);
        },
        reject,
        timestamp: Date.now(),
      });
    });
  }

  public async release(connection: any): Promise<void> {
    const poolConn = this.pool.find((c) => c.connection === connection);
    
    if (!poolConn) {
      this.logger.warn('Attempted to release unknown connection');
      return;
    }

    poolConn.inUse = false;
    poolConn.acquiredAt = null;
    this.healthService.recordActivity(poolConn.id);

    // Process waiting requests
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        waiter.resolve(await this.acquireConnection(poolConn));
      }
    }
  }

  private startAdaptiveSizing(): void {
    this.evaluationInterval = setInterval(() => {
      this.evaluatePoolSize();
    }, this.config.evaluationIntervalMs);
  }

  private evaluatePoolSize(): void {
    const metrics = this.getCurrentMetrics();
    
    // Scale up if utilization is high
    if (metrics.poolUtilization > this.config.scaleUpThreshold) {
      const targetIncrease = Math.min(this.config.scaleUpStep, this.config.maxConnections - this.pool.length);
      if (targetIncrease > 0) {
        this.logger.info(`Scaling up pool by ${targetIncrease} connections`);
        for (let i = 0; i < targetIncrease; i++) {
          this.createConnection().catch((err) => 
            this.logger.error('Failed to scale up connection:', err)
          );
        }
      }
    }

    // Scale down if many idle connections
    const idlePercentage = (metrics.idleConnections / metrics.totalConnections) * 100;
    if (idlePercentage > (100 - this.config.scaleDownThreshold)) {
      const targetDecrease = Math.min(
        this.config.scaleDownStep,
        this.pool.length - this.config.minConnections
      );
      if (targetDecrease > 0) {
        this.logger.info(`Scaling down pool by ${targetDecrease} connections`);
        this.removeIdleConnections(targetDecrease);
      }
    }

    // Store metrics
    this.metrics.push(metrics);
    
    // Cleanup old metrics
    const cutoff = Date.now() - this.config.metricsRetentionMs;
    this.metrics = this.metrics.filter((m) => m.timestamp > cutoff);
  }

  private removeIdleConnections(count: number): void {
    const idleConnections = this.pool.filter((c) => !c.inUse);
    const toRemove = idleConnections.slice(0, count);

    for (const conn of toRemove) {
      this.healthService.unregisterConnection(conn.id);
      const index = this.pool.indexOf(conn);
      if (index !== -1) {
        this.pool.splice(index, 1);
      }
      // Close connection if it has a close method
      if (conn.connection && typeof conn.connection.end === 'function') {
        conn.connection.end().catch(() => {});
      }
    }
  }

  private scheduleLeakCheck(poolConn: PoolConnection): void {
    setTimeout(() => {
      if (poolConn.inUse && poolConn.acquiredAt) {
        const heldDuration = Date.now() - poolConn.acquiredAt;
        if (heldDuration > this.config.connectionLeakThresholdMs) {
          this.logger.warn(
            `Potential connection leak detected: ${poolConn.id} held for ${heldDuration}ms`
          );
          this.emit('connectionLeak', {
            connectionId: poolConn.id,
            durationMs: heldDuration,
          });
        }
      }
    }, this.config.connectionLeakThresholdMs);
  }

  private handleConnectionFailure(error: any): void {
    this.consecutiveFailures++;
    this.logger.error(`Connection failure (${this.consecutiveFailures}):`, error);

    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.isCircuitOpen = true;
      this.circuitOpenedAt = Date.now();
      this.logger.error('Circuit breaker opened due to consecutive failures');
      this.emit('circuitBreakerOpen');
    }
  }

  private setupHealthServiceListeners(): void {
    this.healthService.on('connectionUnhealthy', (connectionId: string) => {
      this.logger.warn(`Removing unhealthy connection: ${connectionId}`);
      const index = this.pool.findIndex((c) => c.id === connectionId);
      if (index !== -1) {
        this.pool.splice(index, 1);
        this.createConnection().catch((err) =>
          this.logger.error('Failed to replace unhealthy connection:', err)
        );
      }
    });

    this.healthService.on('connectionAgeExceeded', (connectionId: string) => {
      const conn = this.pool.find((c) => c.id === connectionId && !c.inUse);
      if (conn) {
        this.logger.info(`Refreshing aged connection: ${connectionId}`);
        const index = this.pool.indexOf(conn);
        this.pool.splice(index, 1);
        this.createConnection().catch((err) =>
          this.logger.error('Failed to refresh aged connection:', err)
        );
      }
    });
  }

  public getCurrentMetrics(): PoolMetrics {
    const active = this.pool.filter((c) => c.inUse).length;
    const idle = this.pool.length - active;

    return {
      totalConnections: this.pool.length,
      activeConnections: active,
      idleConnections: idle,
      waitingRequests: this.waitQueue.length,
      failedConnections: this.consecutiveFailures,
      averageWaitTimeMs: this.calculateAverageWaitTime(),
      averageConnectionTimeMs: 0, // Would need to track actual timing
      poolUtilization: this.pool.length > 0 ? (active / this.pool.length) * 100 : 0,
      timestamp: Date.now(),
    };
  }

  private calculateAverageWaitTime(): number {
    if (this.waitQueue.length === 0) return 0;
    const now = Date.now();
    const totalWait = this.waitQueue.reduce((sum, w) => sum + (now - w.timestamp), 0);
    return totalWait / this.waitQueue.length;
  }

  public getMetricsHistory(): PoolMetrics[] {
    return [...this.metrics];
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down connection pool manager');
    
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
    }

    this.healthService.stop();

    // Close all connections
    for (const conn of this.pool) {
      if (conn.connection && typeof conn.connection.end === 'function') {
        await conn.connection.end().catch(() => {});
      }
    }

    this.pool = [];
    this.waitQueue = [];
    this.metrics = [];
  }
}
