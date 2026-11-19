/**
 * Security Incident Model
 *
 * Full data model for the Automated Security Incident Response System.
 * Extends the original basic CRUD with:
 *   - Extended incident fields (classification, MITRE ATT&CK tags, SIEM ref)
 *   - Timeline event sub-table (security_incident_timeline)
 *   - Evidence/forensic artifact sub-table (security_incident_evidence)
 *   - Rich query methods: list, filter, timeline, stats
 *
 * Part of issue #840 "Automated Security Incident Response System".
 */

import pool from "../config/database";

// ─── Core enumerations ────────────────────────────────────────────────────────

export type SecuritySeverity = "low" | "medium" | "high" | "critical";

export type SecurityIncidentStatus =
  | "open"
  | "investigating"
  | "contained"
  | "eradicated"
  | "recovered"
  | "auto_resolved"
  | "escalated"
  | "dismissed"
  | "closed";

export type IncidentCategory =
  | "authentication"
  | "authorization"
  | "data_exfiltration"
  | "malware"
  | "phishing"
  | "dos"
  | "insider_threat"
  | "supply_chain"
  | "credential_stuffing"
  | "brute_force"
  | "anomalous_behavior"
  | "policy_violation"
  | "unknown";

export type EvidenceType =
  | "log_snapshot"
  | "network_capture"
  | "memory_dump"
  | "disk_image"
  | "process_list"
  | "connection_table"
  | "user_activity"
  | "api_trace"
  | "database_query_log"
  | "file_hash"
  | "screenshot"
  | "raw_payload"
  | "siem_alert";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface SecurityIncident {
  id: string;
  user_id: string | null;
  incident_type: string;
  category: IncidentCategory;
  severity: SecuritySeverity;
  score: number | null;
  details: Record<string, unknown>;
  status: SecurityIncidentStatus;
  response_action: string | null;
  /** MITRE ATT&CK technique IDs (e.g. ["T1078","T1110"]) */
  mitre_tags: string[];
  /** External SIEM alert / correlation ID */
  siem_ref: string | null;
  /** IP address of the originating request */
  source_ip: string | null;
  /** User-agent string */
  source_user_agent: string | null;
  /** Affected resource path/identifier */
  affected_resource: string | null;
  /** Analyst notes (free text) */
  analyst_notes: string | null;
  /** S3 URI of the uploaded forensic evidence bundle (set after S3 upload) */
  s3_uri: string | null;
  /** UTC timestamp when the threat was first observed (may predate created_at) */
  first_seen_at: Date;
  /** UTC timestamp of the most recent related event */
  last_seen_at: Date;
  /** How many times this pattern has been observed */
  occurrence_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface IncidentTimelineEvent {
  id: string;
  incident_id: string;
  event_type: string;
  actor: string | null;
  description: string;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

export interface IncidentEvidence {
  id: string;
  incident_id: string;
  evidence_type: EvidenceType;
  label: string;
  content: Record<string, unknown>;
  hash: string | null;
  collected_at: Date;
  collected_by: string | null;
}

export interface CreateSecurityIncidentPayload {
  userId: string | null;
  incidentType: string;
  category?: IncidentCategory;
  severity: SecuritySeverity;
  score?: number | null;
  details?: Record<string, unknown>;
  status?: SecurityIncidentStatus;
  responseAction?: string | null;
  mitreTags?: string[];
  siemRef?: string | null;
  sourceIp?: string | null;
  sourceUserAgent?: string | null;
  affectedResource?: string | null;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
}

export interface IncidentFilter {
  userId?: string;
  severity?: SecuritySeverity | SecuritySeverity[];
  status?: SecurityIncidentStatus | SecurityIncidentStatus[];
  category?: IncidentCategory;
  siemRef?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface IncidentStats {
  total: number;
  by_severity: Record<SecuritySeverity, number>;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  open_count: number;
  critical_open: number;
  avg_resolution_hours: number | null;
}

// ─── Model ────────────────────────────────────────────────────────────────────

export const SecurityIncidentModel = {

  // ── Core CRUD ──────────────────────────────────────────────────────────────

  /** Insert a new security incident record. */
  async create(entry: CreateSecurityIncidentPayload): Promise<SecurityIncident> {
    const now = new Date();
    const { rows } = await pool.query<SecurityIncident>(
      `INSERT INTO security_incidents
         (user_id, incident_type, category, severity, score, details, status,
          response_action, mitre_tags, siem_ref, source_ip, source_user_agent,
          affected_resource, first_seen_at, last_seen_at, occurrence_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        entry.userId,
        entry.incidentType,
        entry.category ?? "unknown",
        entry.severity,
        entry.score ?? null,
        JSON.stringify(entry.details ?? {}),
        entry.status ?? "open",
        entry.responseAction ?? null,
        JSON.stringify(entry.mitreTags ?? []),
        entry.siemRef ?? null,
        entry.sourceIp ?? null,
        entry.sourceUserAgent ?? null,
        entry.affectedResource ?? null,
        entry.firstSeenAt ?? now,
        entry.lastSeenAt ?? now,
        1,
      ],
    );
    return rows[0];
  },

  /** Fetch a single incident by ID. */
  async findById(id: string): Promise<SecurityIncident | null> {
    const { rows } = await pool.query<SecurityIncident>(
      `SELECT * FROM security_incidents WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Fetch a user's recent security incidents within the last `windowMinutes`. */
  async findRecentByUser(
    userId: string,
    windowMinutes: number,
  ): Promise<SecurityIncident[]> {
    const { rows } = await pool.query<SecurityIncident>(
      `SELECT * FROM security_incidents
       WHERE user_id = $1
         AND created_at >= NOW() - ($2 || ' minutes')::interval
       ORDER BY created_at DESC`,
      [userId, windowMinutes],
    );
    return rows;
  },

  /** List incidents with rich filtering support. */
  async list(filter: IncidentFilter = {}): Promise<{ rows: SecurityIncident[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (filter.userId) {
      conditions.push(`user_id = $${p++}`);
      params.push(filter.userId);
    }
    if (filter.severity) {
      const severities = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
      conditions.push(`severity = ANY($${p++}::text[])`);
      params.push(severities);
    }
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(`status = ANY($${p++}::text[])`);
      params.push(statuses);
    }
    if (filter.category) {
      conditions.push(`category = $${p++}`);
      params.push(filter.category);
    }
    if (filter.siemRef) {
      conditions.push(`siem_ref = $${p++}`);
      params.push(filter.siemRef);
    }
    if (filter.fromDate) {
      conditions.push(`created_at >= $${p++}`);
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      conditions.push(`created_at <= $${p++}`);
      params.push(filter.toDate);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM security_incidents ${where}`,
      params,
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const dataRes = await pool.query<SecurityIncident>(
      `SELECT * FROM security_incidents ${where}
       ORDER BY created_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, limit, offset],
    );

    return { rows: dataRes.rows, total };
  },

  /** Update an incident's status and the response action that was taken. */
  async updateStatus(
    id: string,
    status: SecurityIncidentStatus,
    responseAction?: string | null,
  ): Promise<SecurityIncident | null> {
    const { rows } = await pool.query<SecurityIncident>(
      `UPDATE security_incidents
       SET status = $2,
           response_action = COALESCE($3, response_action),
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, responseAction ?? null],
    );
    return rows[0] ?? null;
  },

  /** Patch arbitrary fields on an incident. */
  async patch(
    id: string,
    updates: Partial<{
      severity: SecuritySeverity;
      status: SecurityIncidentStatus;
      analystNotes: string;
      siemRef: string;
      mitreTags: string[];
      responseAction: string;
      occurrenceCount: number;
      lastSeenAt: Date;
    }>,
  ): Promise<SecurityIncident | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [id];
    let p = 2;

    if (updates.severity !== undefined) { setClauses.push(`severity = $${p++}`); params.push(updates.severity); }
    if (updates.status !== undefined) { setClauses.push(`status = $${p++}`); params.push(updates.status); }
    if (updates.analystNotes !== undefined) { setClauses.push(`analyst_notes = $${p++}`); params.push(updates.analystNotes); }
    if (updates.siemRef !== undefined) { setClauses.push(`siem_ref = $${p++}`); params.push(updates.siemRef); }
    if (updates.mitreTags !== undefined) { setClauses.push(`mitre_tags = $${p++}`); params.push(JSON.stringify(updates.mitreTags)); }
    if (updates.responseAction !== undefined) { setClauses.push(`response_action = $${p++}`); params.push(updates.responseAction); }
    if (updates.occurrenceCount !== undefined) { setClauses.push(`occurrence_count = $${p++}`); params.push(updates.occurrenceCount); }
    if (updates.lastSeenAt !== undefined) { setClauses.push(`last_seen_at = $${p++}`); params.push(updates.lastSeenAt); }

    if (setClauses.length === 0) return this.findById(id);

    setClauses.push(`updated_at = NOW()`);

    const { rows } = await pool.query<SecurityIncident>(
      `UPDATE security_incidents SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  /** Increment occurrence_count and update last_seen_at for a recurring pattern. */
  async recordRecurrence(
    id: string,
    newScore?: number,
  ): Promise<SecurityIncident | null> {
    const { rows } = await pool.query<SecurityIncident>(
      `UPDATE security_incidents
       SET occurrence_count = occurrence_count + 1,
           last_seen_at = NOW(),
           score = CASE WHEN $2::numeric IS NOT NULL THEN $2::numeric ELSE score END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, newScore ?? null],
    );
    return rows[0] ?? null;
  },

  /**
   * Store the S3 URI of the uploaded forensic evidence bundle on the incident record.
   * Writes to the s3_uri column (added in the forensics S3 upload migration).
   */
  async setS3Uri(id: string, s3Uri: string): Promise<SecurityIncident | null> {
    const { rows } = await pool.query<SecurityIncident>(
      `UPDATE security_incidents
       SET s3_uri = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, s3Uri],
    );
    return rows[0] ?? null;
  },

  // ── Timeline ───────────────────────────────────────────────────────────────

  /** Append an event to the incident's timeline. */
  async addTimelineEvent(
    incidentId: string,
    eventType: string,
    description: string,
    actor?: string | null,
    metadata?: Record<string, unknown>,
    occurredAt?: Date,
  ): Promise<IncidentTimelineEvent> {
    const { rows } = await pool.query<IncidentTimelineEvent>(
      `INSERT INTO security_incident_timeline
         (incident_id, event_type, actor, description, metadata, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        incidentId,
        eventType,
        actor ?? null,
        description,
        JSON.stringify(metadata ?? {}),
        occurredAt ?? new Date(),
      ],
    );
    return rows[0];
  },

  /** Retrieve the full timeline for an incident, oldest first. */
  async getTimeline(incidentId: string): Promise<IncidentTimelineEvent[]> {
    const { rows } = await pool.query<IncidentTimelineEvent>(
      `SELECT * FROM security_incident_timeline
       WHERE incident_id = $1
       ORDER BY occurred_at ASC`,
      [incidentId],
    );
    return rows;
  },

  // ── Evidence ───────────────────────────────────────────────────────────────

  /** Attach a forensic evidence artifact to an incident. */
  async addEvidence(
    incidentId: string,
    evidenceType: EvidenceType,
    label: string,
    content: Record<string, unknown>,
    hash?: string | null,
    collectedBy?: string | null,
  ): Promise<IncidentEvidence> {
    const { rows } = await pool.query<IncidentEvidence>(
      `INSERT INTO security_incident_evidence
         (incident_id, evidence_type, label, content, hash, collected_at, collected_by)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6)
       RETURNING *`,
      [incidentId, evidenceType, label, JSON.stringify(content), hash ?? null, collectedBy ?? null],
    );
    return rows[0];
  },

  /** Retrieve all evidence items for an incident. */
  async getEvidence(incidentId: string): Promise<IncidentEvidence[]> {
    const { rows } = await pool.query<IncidentEvidence>(
      `SELECT * FROM security_incident_evidence
       WHERE incident_id = $1
       ORDER BY collected_at ASC`,
      [incidentId],
    );
    return rows;
  },

  // ── Stats ──────────────────────────────────────────────────────────────────

  /** Aggregate incident statistics for a time window. */
  async getStats(fromDate: Date, toDate: Date): Promise<IncidentStats> {
    const [totals, bySev, byStat, byCat, resTime] = await Promise.all([
      pool.query<{ total: string; open_count: string; critical_open: string }>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status NOT IN ('closed','auto_resolved','dismissed')) AS open_count,
                COUNT(*) FILTER (WHERE severity = 'critical' AND status NOT IN ('closed','auto_resolved','dismissed')) AS critical_open
         FROM security_incidents
         WHERE created_at BETWEEN $1 AND $2`,
        [fromDate, toDate],
      ),
      pool.query<{ severity: string; count: string }>(
        `SELECT severity, COUNT(*) AS count FROM security_incidents
         WHERE created_at BETWEEN $1 AND $2 GROUP BY severity`,
        [fromDate, toDate],
      ),
      pool.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) AS count FROM security_incidents
         WHERE created_at BETWEEN $1 AND $2 GROUP BY status`,
        [fromDate, toDate],
      ),
      pool.query<{ category: string; count: string }>(
        `SELECT category, COUNT(*) AS count FROM security_incidents
         WHERE created_at BETWEEN $1 AND $2 GROUP BY category`,
        [fromDate, toDate],
      ),
      pool.query<{ avg_hours: string | null }>(
        `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600) AS avg_hours
         FROM security_incidents
         WHERE created_at BETWEEN $1 AND $2
           AND status IN ('closed','auto_resolved')`,
        [fromDate, toDate],
      ),
    ]);

    const by_severity = { low: 0, medium: 0, high: 0, critical: 0 } as Record<SecuritySeverity, number>;
    for (const r of bySev.rows) by_severity[r.severity as SecuritySeverity] = parseInt(r.count, 10);

    const by_status: Record<string, number> = {};
    for (const r of byStat.rows) by_status[r.status] = parseInt(r.count, 10);

    const by_category: Record<string, number> = {};
    for (const r of byCat.rows) by_category[r.category] = parseInt(r.count, 10);

    const t = totals.rows[0];
    return {
      total: parseInt(t.total, 10),
      by_severity,
      by_status,
      by_category,
      open_count: parseInt(t.open_count, 10),
      critical_open: parseInt(t.critical_open, 10),
      avg_resolution_hours: resTime.rows[0].avg_hours
        ? parseFloat(resTime.rows[0].avg_hours)
        : null,
    };
  },

  // ── SIEM helpers ───────────────────────────────────────────────────────────

  /** Find incidents with matching SIEM correlation reference. */
  async findBySiemRef(siemRef: string): Promise<SecurityIncident[]> {
    const { rows } = await pool.query<SecurityIncident>(
      `SELECT * FROM security_incidents WHERE siem_ref = $1 ORDER BY created_at DESC`,
      [siemRef],
    );
    return rows;
  },

  /** Bulk-update SIEM ref on incidents matching a type pattern within a window. */
  async linkSiemAlert(
    incidentIds: string[],
    siemRef: string,
  ): Promise<number> {
    if (incidentIds.length === 0) return 0;
    const { rowCount } = await pool.query(
      `UPDATE security_incidents
       SET siem_ref = $1, updated_at = NOW()
       WHERE id = ANY($2::uuid[])`,
      [siemRef, incidentIds],
    );
    return rowCount ?? 0;
  },
};
