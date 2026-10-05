/**
 * Recording Consent Service
 *
 * Manages explicit, revocable consent for session recordings.
 *
 * Rules enforced by this service:
 *  1. A recording may only start when BOTH mentor and mentee have active consent.
 *  2. Either participant can revoke consent at any time; doing so stops any
 *     active recording on that session.
 *  3. All consent events are written to audit_logs for GDPR compliance.
 */

import pool from '../config/database';
import { AuditLogService } from './auditLog.service';
import { Logger } from "../utils/logger.utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsentUserRole = 'mentor' | 'mentee';

export interface ConsentRecord {
  id: string;
  session_id: string;
  user_id: string;
  user_role: ConsentUserRole;
  consented: boolean;
  consented_at: Date | null;
  revoked_at: Date | null;
  consent_ip_address: string | null;
  consent_user_agent: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GrantConsentParams {
  sessionId: string;
  userId: string;
  userRole: ConsentUserRole;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RevokeConsentParams {
  sessionId: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SessionConsentStatus {
  sessionId: string;
  mentorConsented: boolean;
  menteeConsented: boolean;
  bothConsented: boolean;
  records: ConsentRecord[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const RecordingConsentService = {
  /**
   * Grant (or re-grant) consent for a user to be recorded in a session.
   *
   * Uses an UPSERT so that calling this endpoint multiple times is idempotent.
   * The previous revoked_at value is cleared when consent is re-granted.
   */
  async grantConsent(params: GrantConsentParams): Promise<ConsentRecord> {
    const { sessionId, userId, userRole, ipAddress, userAgent } = params;

    const { rows } = await pool.query<ConsentRecord>(
      `INSERT INTO recording_consent
         (session_id, user_id, user_role, consented, consented_at, revoked_at,
          consent_ip_address, consent_user_agent)
       VALUES ($1, $2, $3, TRUE, NOW(), NULL, $4, $5)
       ON CONFLICT (session_id, user_id) DO UPDATE SET
         consented            = TRUE,
         consented_at         = NOW(),
         revoked_at           = NULL,
         consent_ip_address   = EXCLUDED.consent_ip_address,
         consent_user_agent   = EXCLUDED.consent_user_agent,
         updated_at           = NOW()
       RETURNING *`,
      [sessionId, userId, userRole, ipAddress ?? null, userAgent ?? null],
    );

    const record = rows[0];

    // Audit log
    await AuditLogService.log({
      userId,
      action: 'RECORDING_CONSENT_GRANTED',
      resourceType: 'session_recording_consent',
      resourceId: sessionId,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      metadata: { sessionId, userRole },
    }).catch((err) =>
      logger.error('Failed to write consent grant audit log', { err }),
    );

    logger.info('Recording consent granted', { sessionId, userId, userRole });
    return record;
  },

  /**
   * Revoke consent.
   *
   * If there is an active recording on this session it will be stopped by the
   * controller after calling this method.  The service only updates the DB record
   * and writes the audit log.
   */
  async revokeConsent(params: RevokeConsentParams): Promise<ConsentRecord | null> {
    const { sessionId, userId, ipAddress, userAgent } = params;

    const { rows } = await pool.query<ConsentRecord>(
      `UPDATE recording_consent
          SET consented          = FALSE,
              revoked_at         = NOW(),
              consent_ip_address = $3,
              consent_user_agent = $4,
              updated_at         = NOW()
        WHERE session_id = $1
          AND user_id    = $2
       RETURNING *`,
      [sessionId, userId, ipAddress ?? null, userAgent ?? null],
    );

    if (rows.length === 0) {
      return null; // no prior consent record — nothing to revoke
    }

    const record = rows[0];

    // Audit log
    await AuditLogService.log({
      userId,
      action: 'RECORDING_CONSENT_REVOKED',
      resourceType: 'session_recording_consent',
      resourceId: sessionId,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      metadata: { sessionId, userRole: record.user_role },
    }).catch((err) =>
      logger.error('Failed to write consent revoke audit log', { err }),
    );

    logger.info('Recording consent revoked', { sessionId, userId });
    return record;
  },

  /**
   * Return the consent status for both participants of a session.
   */
  async getSessionConsentStatus(sessionId: string): Promise<SessionConsentStatus> {
    const { rows } = await pool.query<ConsentRecord>(
      `SELECT *
         FROM recording_consent
        WHERE session_id = $1`,
      [sessionId],
    );

    const mentorRecord = rows.find((r) => r.user_role === 'mentor');
    const menteeRecord = rows.find((r) => r.user_role === 'mentee');

    const mentorConsented = mentorRecord?.consented === true;
    const menteeConsented = menteeRecord?.consented === true;

    return {
      sessionId,
      mentorConsented,
      menteeConsented,
      bothConsented: mentorConsented && menteeConsented,
      records: rows,
    };
  },

  /**
   * Return the consent record for a specific user and session, or null if none.
   */
  async getUserConsent(
    sessionId: string,
    userId: string,
  ): Promise<ConsentRecord | null> {
    const { rows } = await pool.query<ConsentRecord>(
      `SELECT *
         FROM recording_consent
        WHERE session_id = $1
          AND user_id    = $2`,
      [sessionId, userId],
    );
    return rows[0] ?? null;
  },

  /**
   * Returns true only when BOTH mentor and mentee have active (not revoked) consent.
   * This is the guard used before starting a recording.
   */
  async bothParticipantsConsented(sessionId: string): Promise<boolean> {
    const { rows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
         FROM recording_consent
        WHERE session_id = $1
          AND consented  = TRUE`,
      [sessionId],
    );
    return parseInt(rows[0]?.cnt ?? '0', 10) >= 2;
  },

  /**
   * Stop the most-recent active recording for a session due to consent revocation.
   *
   * Updates session_recordings.status to 'processing' and sets recording_ended_at.
   * Returns the recording ID if one was stopped, otherwise null.
   */
  async stopActiveRecordingOnRevocation(
    sessionId: string,
    revokedByUserId: string,
  ): Promise<string | null> {
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE session_recordings
          SET status             = 'processing',
              recording_ended_at = NOW(),
              metadata           = metadata || $2::jsonb,
              updated_at         = NOW()
        WHERE session_id = $1
          AND status     = 'recording'
       RETURNING id`,
      [
        sessionId,
        JSON.stringify({
          stopped_reason: 'consent_revoked',
          stopped_by_user_id: revokedByUserId,
          stopped_at: new Date().toISOString(),
        }),
      ],
    );

    if (rows.length === 0) {
      return null;
    }

    const recordingId = rows[0].id;
    logger.info('Active recording stopped due to consent revocation', {
      sessionId,
      recordingId,
      revokedByUserId,
    });
    return recordingId;
  },
};

export default RecordingConsentService;
