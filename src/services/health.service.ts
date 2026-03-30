import pool from '../config/database';
import { server } from '../config/stellar';
import config from '../config';
import { redisConfig } from '../config/redis.config';
import { logger } from '../utils/logger.utils';
import { CURRENT_VERSION } from '../config/api-versions.config';
import * as os from 'node:os';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthComponent {
  status: HealthStatus;
  responseTimeMs?: number;
  error?: string;
  details?: Record<string, any>;
}

export interface DetailedHealthStatus {
  status: HealthStatus;
  components: {
    db: HealthComponent;
    redis: HealthComponent;
    horizon: HealthComponent;
    system?: HealthComponent;
  };
  uptime: number;
  version: string;
  timestamp: string;
}

// ─── Health Service ───────────────────────────────────────────────────────────

export class HealthService {
  private static readinessCache: {
    status: DetailedHealthStatus;
    timestamp: number;
  } | null = null;

  private static readonly CACHE_TTL_MS = 5000;

  /**
   * GET /health/live
   * Basic liveness check - returns true if the process is alive.
   */
  static isLive(): boolean {
    return true;
  }

  /**
   * GET /health/ready
   * Readiness probe - checks critical dependencies.
   * Cached for 5 seconds to prevent hammering.
   */
  static async checkReadiness(): Promise<DetailedHealthStatus> {
    const now = Date.now();
    if (this.readinessCache && now - this.readinessCache.timestamp < this.CACHE_TTL_MS) {
      return this.readinessCache.status;
    }

    const status = await this.performFullCheck();
    this.readinessCache = {
      status,
      timestamp: now,
    };
    
    return status;
  }

  /**
   * Internal full health check
   */
  private static async performFullCheck(): Promise<DetailedHealthStatus> {
    const [dbCheck, redisCheck, horizonCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkHorizon(),
    ]);

    // Critical components for readiness: all must not be 'unhealthy'
    const criticalComponents = [dbCheck, redisCheck, horizonCheck];
    const isUnhealthy = criticalComponents.some(c => c.status === 'unhealthy');
    const isDegraded = !isUnhealthy && criticalComponents.some(c => c.status === 'degraded');
    
    const status: HealthStatus = isUnhealthy ? 'unhealthy' : (isDegraded ? 'degraded' : 'healthy');

    if (status !== 'healthy') {
      logger.warn('Health check failed or degraded', {
        status,
        db: dbCheck.status,
        redis: redisCheck.status,
        horizon: horizonCheck.status,
      });
    }

    return {
      status,
      components: {
        db: dbCheck,
        redis: redisCheck,
        horizon: horizonCheck,
        system: this.getSystemInfo(),
      },
      uptime: process.uptime(),
      version: config.server.apiVersion || CURRENT_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  private static async checkDatabase(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      await pool.query('SELECT 1');
      return { status: 'healthy', responseTimeMs: Date.now() - start };
    } catch (err: any) {
      return { 
        status: 'unhealthy', 
        responseTimeMs: Date.now() - start, 
        error: err.message 
      };
    }
  }

  private static async checkRedis(): Promise<HealthComponent> {
    const start = Date.now();
    if (!redisConfig.url) {
        return { status: 'degraded', error: 'Redis URL not configured' };
    }
    try {
      const Redis = (await import('ioredis')).default;
      const client = new Redis(redisConfig.url, { ...redisConfig.options, lazyConnect: true });
      await client.connect();
      await client.ping();
      client.disconnect();
      return { status: 'healthy', responseTimeMs: Date.now() - start };
    } catch (err: any) {
      return { 
        status: 'unhealthy', 
        responseTimeMs: Date.now() - start, 
        error: err.message 
      };
    }
  }

  private static async checkHorizon(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      await server.ledgers().limit(1).call();
      return { status: 'healthy', responseTimeMs: Date.now() - start };
    } catch (err: any) {
      return { 
        status: 'degraded', 
        responseTimeMs: Date.now() - start, 
        error: err.message 
      };
    }
  }

  private static getSystemInfo(): HealthComponent {
    return {
      status: 'healthy',
      details: {
        memory: process.memoryUsage(),
        cpu: os.loadavg(),
        freeMem: os.freemem(),
        totalMem: os.totalmem(),
      }
    };
  }

  static async initialize(): Promise<void> {
    logger.info('HealthService initialized');
  }
}

export default HealthService;
