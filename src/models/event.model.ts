import { db } from "../config/database";
import { Logger } from "../utils/logger.utils";

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
  async append(event: Omit<DomainEvent, "id">): Promise<DomainEvent | null> {
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
      JSON.stringify(event.metadata),
    ];

    try {
      const { rows } = await db.query(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error({ err: error }, "Failed to append event");
      return null;
    }
  },

  async getEvents(
    aggregateId: string,
    fromVersion = 1,
  ): Promise<DomainEvent[]> {
    const query = `
      SELECT * FROM domain_events
      WHERE aggregate_id = $1 AND version >= $2
      ORDER BY version ASC;
    `;
    const { rows } = await db.query(query, [aggregateId, fromVersion]);
    return rows;
  },

  async createSnapshot(
    snapshot: Omit<Snapshot, "id" | "createdAt">,
  ): Promise<Snapshot | null> {
    const query = `
      INSERT INTO snapshots (aggregate_id, aggregate_type, version, data)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (aggregate_id, version) DO UPDATE SET data = $4
      RETURNING *;
    `;

    const values = [
      snapshot.aggregateId,
      snapshot.aggregateType,
      snapshot.version,
      JSON.stringify(snapshot.data),
    ];

    try {
      const { rows } = await db.query(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error({ err: error }, "Failed to save snapshot");
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
    const { rows } = await db.query(query, [aggregateId]);
    return rows[0] || null;
  },

  async getLatestVersion(aggregateId: string): Promise<number> {
    const query = `
      SELECT COALESCE(MAX(version), 0) as version
      FROM domain_events
      WHERE aggregate_id = $1;
    `;
    const { rows } = await db.query(query, [aggregateId]);
    return rows[0].version;
  },

  async replay(
    aggregateId: string,
    _aggregateType: string,
    applyEvent: (state: Record<string, any>, event: DomainEvent) => Record<string, any>,
    initialState: Record<string, any> = {},
    toVersion?: number,
  ): Promise<Record<string, any>> {
    const snapshot = await this.getLatestSnapshot(aggregateId);
    let state = snapshot ? snapshot.data : initialState;
    const fromVersion = snapshot ? snapshot.version + 1 : 1;

    let query = `
      SELECT * FROM domain_events
      WHERE aggregate_id = $1 AND version >= $2
    `;
    const params: any[] = [aggregateId, fromVersion];

    if (toVersion) {
      query += ` AND version <= $3`;
      params.push(toVersion);
    }

    query += ` ORDER BY version ASC;`;

    const { rows } = await db.query(query, params);

    for (const event of rows) {
      state = applyEvent(state, event);
    }

    return state;
  },
};

