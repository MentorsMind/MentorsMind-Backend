import pool from "../config/database";

/**
 * Small helper types for GraphQL DataLoader bulk batching.
 * Kept in a separate module so we can add bulk queries without affecting existing single-id methods.
 */

export type UUID = string;

export interface IdToRowsMap<T> {
  [id: string]: T[];
}

export async function mapIdsToGroupedRows<T>(
  ids: UUID[],
  rows: Array<{ key: UUID; value: T }>,
): Promise<IdToRowsMap<T>> {
  const map: IdToRowsMap<T> = Object.create(null);
  for (const id of ids) map[id] = [];
  for (const r of rows) {
    if (!map[r.key]) map[r.key] = [];
    map[r.key].push(r.value);
  }
  return map;
}

export async function uniq<T>(arr: T[]): Promise<T[]> {
  return Array.from(new Set(arr));
}

export async function ensureArray<T>(
  v: T | T[] | null | undefined,
): Promise<T[]> {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// Note: Actual SQL bulk queries live in the specific model files (payments/reviews/bookings)
// to keep SQL aligned with each table and prevent accidental schema mismatches.
