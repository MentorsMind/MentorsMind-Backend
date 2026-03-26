import { Pool, PoolClient } from 'pg';
import pool from '../config/database';
import { logger } from './logger';

export type SeedFn = (client: PoolClient, size: SeedSize) => Promise<void>;

export type SeedSize = 'test' | 'dev';

export const SEED_SIZES: Record<SeedSize, { mentors: number; mentees: number; sessionsPerMentor: number }> = {
  test: { mentors: 2, mentees: 3, sessionsPerMentor: 2 },
  dev:  { mentors: 5, mentees: 10, sessionsPerMentor: 5 },
};

/** Deterministic pseudo-random number seeded by a string key */
export function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h ^= h << 13;
    h ^= h >> 17;
    h ^= h << 5;
    return ((h >>> 0) / 0xffffffff);
  };
}

export function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function pickN<T>(arr: T[], n: number, rng: () => number): T[] {
  const shuffled = [...arr].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/** Run all seed functions inside a single transaction */
export async function runSeeds(seeds: SeedFn[], size: SeedSize = 'dev'): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const seed of seeds) {
      await seed(client, size);
    }
    await client.query('COMMIT');
    logger.info('All seeds completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Seed failed, rolled back', { error: err instanceof Error ? err.message : err });
    throw err;
  } finally {
    client.release();
  }
}

/** Truncate all seeded tables in dependency order */
export async function resetDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      TRUNCATE TABLE
        review_votes, review_reports, reviews,
        transaction_events, transactions,
        wallet_balances, wallets,
        bookings,
        users
      RESTART IDENTITY CASCADE
    `);
    await client.query('COMMIT');
    logger.info('Database reset complete');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Reset failed', { error: err instanceof Error ? err.message : err });
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
