import pool from '../config/database';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface DomainEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  version: number;
  data: Record<string, any>;
  metadata: {
    userId: string;
    timestamp: Date;
    correlationId: string;
  };
}

export interface Snapshot {
  id: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  data: Record<string, any>;
  createdAt: Date;
}

export const EventStoreModel = {
  async initializeTables(): Promise<void> {
    const queries = [
      `
        CREATE TABLE IF NOT EXISTS domain_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          aggregate_id UUID NOT NULL,
          aggregate_type VARCHAR(100) NOT NULL,
          event_type VARCHAR(100) NOT NULL,
          version INTEGER NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(aggregate_id, version)
        );
        
        CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate ON domain_events(aggregate_id, aggregate_type);
        CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_domain_events_created ON domain_events(created_at);
      `,
      `
        CREATE TABLE IF NOT EXISTS snapshots (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          aggregate_id UUID NOT NULL,
          aggregate_type VARCHAR(100) NOT NULL,
          version INTEGER NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(aggregate_id, version)
        );
        
        CREATE INDEX IF NOT EXISTS idx_snapshots_aggregate ON snapshots(aggregate_id, aggregate_type, version DESC);
      `
    ];

    for (const query of queries) {
      await pool.query(query);
    }
  },

  async append(event: Omit<DomainEvent, 'id'>): Promise<DomainEvent | null> {
    const query = `
      INSERT INTO domain_events (
        aggregate_id, aggregate_type, event_type, version, data, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    const values = [
      event.aggregateId,
      event.aggregateType,
      event.eventType,
      event.version,
      JSON.stringify(event.data),
      JSON.stringify(event.metadata)
    ];

    try {
      const { rows } = await pool.query<DomainEvent>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error({ err: error }, 'Failed to append event');
      return null;
    }
  },

  async getEvents(aggregateId: string, fromVersion = 1): Promise<DomainEvent[]> {
    const query = `
      SELECT * FROM domain_events
      WHERE aggregate_id = $1 AND version >= $2
      ORDER BY version ASC;
    `;

    const { rows } = await pool.query<DomainEvent>(query, [aggregateId, fromVersion]);
    return rows;
  },

  async getLatestVersion(aggregateId: string): Promise<number> {
    const query = `
      SELECT MAX(version) as version FROM domain_events
      WHERE aggregate_id = $1;
    `;

    const { rows } = await pool.query(query, [aggregateId]);
    return rows[0]?.version || 0;
  },

  async createSnapshot(snapshot: Omit<Snapshot, 'id' | 'createdAt'>): Promise<Snapshot | null> {
    const query = `
      INSERT INTO snapshots (
        aggregate_id, aggregate_type, version, data
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const values = [
      snapshot.aggregateId,
      snapshot.aggregateType,
      snapshot.version,
      JSON.stringify(snapshot.data)
    ];

    try {
      const { rows } = await pool.query<Snapshot>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error({ err: error }, 'Failed to create snapshot');
      return null;
    }
  },

  async getLatestSnapshot(aggregateId: string): Promise<Snapshot | null> {
    const query = `
      SELECT * FROM snapshots
      WHERE aggregate_id = $1
      ORDER BY version DESC
      LIMIT 1;
    `;

    const { rows } = await pool.query<Snapshot>(query, [aggregateId]);
    return rows[0] || null;
  },

  async replay(
    aggregateId: string,
    aggregateType: string,
    applyEvent: (state: Record<string, any>, event: DomainEvent) => Record<string, any>,
    initialState: Record<string, any> = {},
    toVersion?: number
  ): Promise<Record<string, any>> {
    let state = initialState;
    let fromVersion = 1;

    const snapshot = await this.getLatestSnapshot(aggregateId);
    if (snapshot) {
      state = snapshot.data;
      fromVersion = snapshot.version + 1;
    }

    const events = await this.getEvents(aggregateId, fromVersion);
    for (const event of events) {
      if (toVersion && event.version > toVersion) {
        break;
      }
      state = applyEvent(state, event);
    }

    return state;
  }
};
