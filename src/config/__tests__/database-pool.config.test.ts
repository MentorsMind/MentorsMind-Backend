import { createOptimizedPool, poolConfig } from '../database-pool.config';
import { Pool } from 'pg';

jest.mock('pg', () => {
  const mPool = {
    on: jest.fn(),
    connect: jest.fn(),
    query: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

describe('Database Pool Configuration', () => {
  it('should have optimized pool settings configured', () => {
    expect(poolConfig.max).toBeDefined();
    expect(poolConfig.idleTimeoutMillis).toBeDefined();
    expect(poolConfig.statement_timeout).toBe(10000);
    expect(poolConfig.min).toBe(4);
    expect(poolConfig.allowExitOnIdle).toBe(false);
  });

  it('should successfully create an optimized pool instance', () => {
    const pool = createOptimizedPool();
    expect(Pool).toHaveBeenCalledWith(poolConfig);
    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(pool.on).toHaveBeenCalledWith('connect', expect.any(Function));
  });
});
