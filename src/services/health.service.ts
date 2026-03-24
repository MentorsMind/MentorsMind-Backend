import pool from '../config/database';
import { server } from '../config/stellar';
import monitoringConfig, { MonitoringConfig } from '../config/monitoring.config';
import { redisConfig } from '../config/redis.config';
import { logger } from '../utils/logger.utils';
import promClient, { Registry, Gauge, Histogram, Counter } from 'prom-client';
import config from '../config';
import { CURRENT_VERSION } from '../config/api-versions.config';
import * as os from 'node:os';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HealthComponent {
  status: 'healthy' | 'degraded' | 'down';
  responseTimeMs?: number;
  details?: Record<string, any>;
}

export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  components: {
    database: HealthComponent;
    redis?: HealthComponent;
    stellar: HealthComponent;
    system: HealthComponent;
  };
  version: string;
  uptime: number;
  environment: string;
}

export interface PrometheusMetrics {
  uptime: Gauge<string>;
  memory_usage: Gauge<string>;
  cpu_load: Gauge<string>;
  db_connections_active: Gauge<string>;
  redis_memory_used: Gauge<string>;
  health_degraded_components: Gauge<string>;
}

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

let metricsRegistry: Registry;
let metrics: PrometheusMetrics;

async function initializeMetrics(): Promise<void> {
  if (!monitoringConfig.prometheus.enabled) return;

  metricsRegistry = new promClient.Registry();
  promClient.collectDefaultMetrics({ register: metricsRegistry });

  metrics = {
    uptime: new promClient.Gauge({
      name: 'app_uptime_seconds',
      help: 'Application uptime in seconds',
      registers: [metricsRegistry],
    }),
    memory_usage: new promClient.Gauge({
      name: 'process_memory_usage_bytes',
      help: 'Process memory usage by type',
      labelNames: ['type'],
      registers: [metricsRegistry],
    }),
    cpu_load: new promClient.Gauge({
      name: 'system_cpu_load_average',
      help: 'System CPU load averages',
      labelNames: ['type'],
      registers: [metricsRegistry],
    }),
    db_connections_active: new promClient.Gauge({
      name: 'database_connections_active',
      help: 'Active database connections',
      registers: [metricsRegistry],
    }),
    redis_memory_used: new promClient.Gauge({
      name: 'redis_memory_used_bytes',
      help: 'Redis memory usage',
      registers: [metricsRegistry],
    }),
    health_degraded_components: new promClient.Gauge({
      name: 'health_degraded_components',
      help: 'Number of degraded health components',
      registers: [metricsRegistry],
    }),
  };

  // Update system metrics periodically
  setInterval(updateSystemMetrics, 30_000);
}

// ─── Redis Client for Health ──────────────────────────────────────────────────

let redisHealthClient: any = null;

async function getRedisHealthClient() {
  if (redisHealthClient) return redisHealthClient;
  
  try {
    const Redis = (await import('ioredis')).default;
    redisHealthClient = new Redis(redisConfig.url, redisConfig.options);
    await redisHealthClient.ping();
    return redisHealthClient;
  } catch {
    return null;
  }
}

// ─── Individual Health Checks ─────────────────────────────────────────────────

async function checkDatabase(): Promise<HealthComponent> {
  const start = Date.now();
  try {
    await pool.query('SELECT 1 as healthy');
    const duration = Date.now() - start;
    if (monitoringConfig.metrics.trackDatabase) {
      (metrics as any)?.db_connections_active.set(pool.totalCount);
    }
    logger.debug('Health: Database OK', { responseTimeMs: duration });
    return { status: 'healthy' as const, responseTimeMs: duration };
  } catch (error) {
    logger.warn('Health: Database DOWN', { error: (error as Error).message });
    return { 
      status: 'down' as const, 
      responseTimeMs: Date.now() - start,
      details: { error: (error as Error).message }
    };
  }
}

async function checkRedis(): Promise<HealthComponent | undefined> {
  if (!redisConfig.url) return undefined;
  
  const start = Date.now();
  try {
    const client = await getRedisHealthClient();
    if (!client) return { status: 'degraded' as const, responseTimeMs: 0, details: { fallback: 'memory' } };
    
    const [[resTime], memoryInfo] = await Promise.all([
      client.ping() as any,
      client.info('memory') as any
    ]);
    
    const usedMemory = parseInt(memoryInfo.match(/used_memory_human:(\S+)/)?.[1] || '0', 10) * 1024 * 1024;
    const duration = Date.now() - start;
    
    if (monitoringConfig.metrics.trackRedis) {
      (metrics as any)?.redis_memory_used.set(usedMemory);
    }
    
    logger.debug('Health: Redis OK', { responseTimeMs: duration, memoryUsed: usedMemory });
    return { status: 'healthy' as const, responseTimeMs: duration, details: { memoryUsed: usedMemory } };
  } catch (error) {
    logger.warn('Health: Redis DOWN', { error: (error as Error).message });
    return { 
      status: 'down' as const, 
      responseTimeMs: Date.now() - start,
      details: { error: (error as Error).message }
    };
  }
}

async function checkStellar(): Promise<HealthComponent> {
  const start = Date.now();
  try {
    await server.ledgers().limit(1).call();
    const duration = Date.now() - start;
    logger.debug('Health: Stellar OK', { responseTimeMs: duration });
    return { status: 'healthy' as const, responseTimeMs: duration };
  } catch (error) {
    logger.warn('Health: Stellar DOWN', { error: (error as Error).message });
    return { 
      status: 'down' as const, 
      responseTimeMs: Date.now() - start,
      details: { error: (error as Error).message }
    };
  }
}

function checkSystem(): HealthComponent {
  const memory = process.memoryUsage();
  const cpuLoad = os.loadavg();
  
  const duration = 0; // Instant
  
  if (monitoringConfig.metrics.trackRequests) {
    (metrics as any)?.uptime.set(process.uptime());
    (metrics as any)?.memory_usage.set(memory.heapUsed, 'heap_used');
    (metrics as any)?.memory_usage.set(memory.rss, 'rss');
    (metrics as any)?.cpu_load.set(cpuLoad[0], '1min');
    (metrics as any)?.cpu_load.set(cpuLoad[1], '5min');
    (metrics as any)?.cpu_load.set(cpuLoad[2], '15min');
  }
  
  logger.debug('Health: System OK');
  return { 
    status: 'healthy' as const, 
    responseTimeMs: duration,
    details: { uptime: process.uptime(), memory, cpuLoad }
  };
}

function updateSystemMetrics() {
  checkSystem();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class HealthService {
  /**
   * Perform comprehensive health check
   */
  static async checkHealth(): Promise<HealthStatus> {
    const start = Date.now();
    
    const [database, redis, stellar, system] = await Promise.allSettled([
      checkDatabase(),
      checkRedis(),
      checkStellar(),
      Promise.resolve(checkSystem())
    ]);
    
    const components = {
      database: (database.status === 'fulfilled' ? database.value : { status: 'down' as const, details: { error: 'check failed' } }) as HealthComponent,
      redis: (redis.status === 'fulfilled' ? redis.value : { status: 'down' as const }) as HealthComponent | undefined,
      stellar: (stellar.status === 'fulfilled' ? stellar.value : { status: 'down' as const }) as HealthComponent,
      system: (system.status === 'fulfilled' ? system.value : { status: 'down' as const }) as HealthComponent,
    };
    
    const degradedCount = Object.values(components).filter(c => c.status !== 'healthy').length;
    const overall = degradedCount === 0 ? 'healthy' : (degradedCount < 3 ? 'degraded' : 'down') as any;
    
    if (monitoringConfig.metrics.trackDatabase) {
      (metrics as any)?.health_degraded_components.set(degradedCount);
    }
    
    const result: HealthStatus = {
      overall,
      timestamp: new Date().toISOString(),
      components,
      version: config.server.apiVersion || CURRENT_VERSION,
      uptime: process.uptime(),
      environment: config.env,
    };
    
    const duration = Date.now() - start;
    logger.info('Health check complete', { 
      overall, 
      degradedCount, 
      responseTimeMs: duration,
      structured: monitoringConfig.logging.structuredHealth 
    });
    
    return result;
  }

  /**
   * Get Prometheus metrics text
   */
  static async getMetrics(): Promise<string> {
    await initializeMetrics();
    if (!metricsRegistry) {
      throw new Error('Prometheus metrics not enabled');
    }
    return await metricsRegistry.metrics();
  }

  /**
   * Initialize health service (called on app startup)
   */
  static async initialize(): Promise<void> {
    logger.info('Initializing HealthService');
    await initializeMetrics();
    updateSystemMetrics(); // Initial scrape
  }
}

// Export for tests
export default HealthService;

