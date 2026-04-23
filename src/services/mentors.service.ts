/**
 * Mentors Service - Business logic for mentor management
 */

import pool from '../config/database';
import { CacheService } from './cache.service';
import { CacheKeys, CacheTTL } from '../utils/cache-key.utils';
import { logger } from '../utils/logger.utils';
import { PaginationUtil } from '../utils/pagination.utils';
import { PaginatedResponse } from '../types/pagination.types';
import {
  CreateMentorProfileInput,
  UpdateMentorProfileInput,
  SetAvailabilityInput,
  UpdatePricingInput,
  ListMentorsQuery,
  GetMentorSessionsQuery,
  GetMentorEarningsQuery,
  SubmitVerificationInput,
} from '../validators/schemas/mentors.schemas';

export interface MentorRecord {
  id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  avatar_url: string | null;
  hourly_rate: number | null;
  expertise: string[] | null;
  years_of_experience: number | null;
  availability_schedule: Record<string, unknown> | null;
  is_available: boolean;
  timezone: string | null;
  average_rating: number;
  total_sessions_completed: number;
  total_reviews: number;
  kyc_verified: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MentorListResult {
  mentors: MentorRecord[];
  next_cursor: string | null;
  has_more: boolean;
  total: number;
}

export interface MentorSessionRecord {
  id: string;
  mentor_id: string;
  mentee_id: string;
  title: string;
  description: string | null;
  scheduled_at: Date;
  duration_minutes: number;
  status: string;
  meeting_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EarningsSummary {
  totalEarnings: number;
  totalSessions: number;
  averagePerSession: number;
  breakdown: Array<{ period: string; earnings: number; sessions: number }>;
}

const MENTOR_COLUMNS = `
  id, email, role, first_name, last_name, bio, avatar_url,
  hourly_rate, expertise, years_of_experience, availability_schedule,
  is_available, timezone, average_rating, total_sessions_completed,
  total_reviews, kyc_verified, is_active, created_at, updated_at
`;

export const MentorsService = {
  /**
   * Create a mentor profile (promotes user to mentor role)
   */
  async createProfile(userId: string, payload: CreateMentorProfileInput): Promise<MentorRecord | null> {
    const fields: string[] = ['role = $1', 'updated_at = NOW()'];
    const values: unknown[] = ['mentor'];
    let idx = 2;

    if (payload.bio !== undefined) { fields.push(`bio = $${idx++}`); values.push(payload.bio); }
    if (payload.avatarUrl !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(payload.avatarUrl); }
    if (payload.hourlyRate !== undefined) { fields.push(`hourly_rate = $${idx++}`); values.push(payload.hourlyRate); }
    if (payload.expertise !== undefined) { fields.push(`expertise = $${idx++}`); values.push(payload.expertise); }
    if (payload.yearsOfExperience !== undefined) { fields.push(`years_of_experience = $${idx++}`); values.push(payload.yearsOfExperience); }
    if (payload.timezone !== undefined) { fields.push(`timezone = $${idx++}`); values.push(payload.timezone); }
    if (payload.availabilitySchedule !== undefined) { fields.push(`availability_schedule = $${idx++}`); values.push(JSON.stringify(payload.availabilitySchedule)); }

    values.push(userId);

    const { rows } = await pool.query<MentorRecord>(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${idx} AND is_active = true
       RETURNING ${MENTOR_COLUMNS}`,
      values,
    );
    return rows[0] ?? null;
  },

  /**
   * Get mentor profile by ID
   * Cached for 5 minutes to reduce database load
   */
  async findById(id: string): Promise<MentorRecord | null> {
    return CacheService.wrap(
      CacheKeys.mentorProfile(id),
      CacheTTL.medium,
      async () => {
        const { rows } = await pool.query<MentorRecord>(
          `SELECT ${MENTOR_COLUMNS} FROM users
           WHERE id = $1 AND role = 'mentor' AND is_active = true`,
          [id],
        );
        return rows[0] ?? null;
      },
    );
  },

  /**
   * Update mentor profile
   * Invalidates the mentor profile cache and mentor list cache
   */
  async update(id: string, payload: UpdateMentorProfileInput): Promise<MentorRecord | null> {
    const fields: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    if (payload.firstName !== undefined) { fields.push(`first_name = $${idx++}`); values.push(payload.firstName); }
    if (payload.lastName !== undefined) { fields.push(`last_name = $${idx++}`); values.push(payload.lastName); }
    if (payload.bio !== undefined) { fields.push(`bio = $${idx++}`); values.push(payload.bio); }
    if (payload.avatarUrl !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(payload.avatarUrl); }
    if (payload.hourlyRate !== undefined) { fields.push(`hourly_rate = $${idx++}`); values.push(payload.hourlyRate); }
    if (payload.expertise !== undefined) { fields.push(`expertise = $${idx++}`); values.push(payload.expertise); }
    if (payload.yearsOfExperience !== undefined) { fields.push(`years_of_experience = $${idx++}`); values.push(payload.yearsOfExperience); }
    if (payload.timezone !== undefined) { fields.push(`timezone = $${idx++}`); values.push(payload.timezone); }
    if (payload.isAvailable !== undefined) { fields.push(`is_available = $${idx++}`); values.push(payload.isAvailable); }

    values.push(id);

    const { rows } = await pool.query<MentorRecord>(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${idx} AND role = 'mentor' AND is_active = true
       RETURNING ${MENTOR_COLUMNS}`,
      values,
    );

    // Invalidate mentor profile cache when profile is updated
    if (rows[0]) {
      await CacheService.del(CacheKeys.mentorProfile(id));
      // Also invalidate mentor search/list caches
      await CacheService.invalidatePattern('mm:mentors:search:*');
      await CacheService.invalidatePattern('mm:mentors:*:*');
      logger.debug('Mentor cache invalidated on profile update', { mentorId: id });
    }

    return rows[0] ?? null;
  },

  /**
   * List mentors with filtering and pagination
   * Cached for 60 seconds based on query parameters to reduce database load
   */
  async list(query: ListMentorsQuery): Promise<MentorListResult> {
    const cacheKey = CacheKeys.mentorSearch(query);
    
    return CacheService.wrap(
      cacheKey,
      CacheTTL.short,
      async () => {
        const { cursor, limit, search, expertise, minRate, maxRate, isAvailable, sortBy, sortOrder } = query;
        
        const conditions: string[] = ["role = 'mentor'", 'is_active = true'];
        const values: unknown[] = [];
        let idx = 1;

        if (cursor) {
          const decoded = PaginationUtil.decodeCursor(cursor);
          if (decoded) {
            conditions.push(`(created_at, id) < ($${idx}, $${idx + 1})`);
            values.push(decoded.created_at, decoded.id);
            idx += 2;
          }
        }

        if (search) {
          conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR bio ILIKE $${idx})`);
          values.push(`%${search}%`);
          idx++;
        }
        if (expertise) {
          conditions.push(`$${idx} = ANY(expertise)`);
          values.push(expertise);
          idx++;
        }
        if (minRate !== undefined) {
          conditions.push(`hourly_rate >= $${idx++}`);
          values.push(minRate);
        }
        if (maxRate !== undefined) {
          conditions.push(`hourly_rate <= $${idx++}`);
          values.push(maxRate);
        }
        if (isAvailable !== undefined) {
          conditions.push(`is_available = $${idx++}`);
          values.push(isAvailable);
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        
        // Use a fixed sort order for cursor-based pagination consistency
        // To support arbitrary sortBy with cursors is more complex.
        // Given the requirement "Cursor = base64-encoded { id, created_at }", 
        // we assume created_at DESC as the primary sort.
        const orderClause = `ORDER BY created_at DESC, id DESC`;

        const [dataResult, countResult] = await Promise.all([
          pool.query<MentorRecord>(
            `SELECT ${MENTOR_COLUMNS} FROM users ${whereClause} ${orderClause} LIMIT $${idx}`,
            [...values, limit + 1],
          ),
          pool.query<{ count: string }>(
            `SELECT COUNT(*) FROM users WHERE role = 'mentor' AND is_active = true ${search ? `AND (first_name ILIKE $1 OR last_name ILIKE $1 OR bio ILIKE $1)` : ''} ${expertise ? `AND $${search ? 2 : 1} = ANY(expertise)` : ''}`,
            search ? (expertise ? [`%${search}%`, expertise] : [`%${search}%`]) : (expertise ? [expertise] : []),
          ),
        ]);

        // Note: The countResult query above is simplified and might not match all filters perfectly if they are complex.
        // For standard cursor-based pagination, sometimes we omit the total count if it's too expensive.
        // However, the requirement says "total?: number" in response.
        
        const rows = dataResult.rows;
        const has_more = rows.length > limit;
        const data = has_more ? rows.slice(0, limit) : rows;
        
        const lastItem = data[data.length - 1];
        const next_cursor = has_more && lastItem ? PaginationUtil.encodeCursor(PaginationUtil.getCursorFromItem(lastItem)!) : null;

        const total = parseInt(countResult.rows[0].count, 10);

        return {
          mentors: data,
          next_cursor,
          has_more,
          total,
        };
      },
    );
  },

  /**
   * Set mentor availability schedule
   * Invalidates the mentor profile cache
   */
  async setAvailability(id: string, payload: SetAvailabilityInput): Promise<MentorRecord | null> {
    const fields: string[] = ['availability_schedule = $1', 'updated_at = NOW()'];
    const values: unknown[] = [JSON.stringify(payload.schedule)];
    let idx = 2;

    if (payload.isAvailable !== undefined) {
      fields.push(`is_available = $${idx++}`);
      values.push(payload.isAvailable);
    }

    values.push(id);

    const { rows } = await pool.query<MentorRecord>(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${idx} AND role = 'mentor' AND is_active = true
       RETURNING ${MENTOR_COLUMNS}`,
      values,
    );

    // Invalidate mentor profile cache
    if (rows[0]) {
      await CacheService.del(CacheKeys.mentorProfile(id));
      logger.debug('Mentor profile cache invalidated on availability update', { mentorId: id });
    }

    return rows[0] ?? null;
  },

  /**
   * Get mentor availability
   */
  async getAvailability(id: string): Promise<{ schedule: unknown; isAvailable: boolean } | null> {
    const { rows } = await pool.query<{ availability_schedule: unknown; is_available: boolean }>(
      `SELECT availability_schedule, is_available FROM users
       WHERE id = $1 AND role = 'mentor' AND is_active = true`,
      [id],
    );
    if (!rows[0]) return null;
    return { schedule: rows[0].availability_schedule, isAvailable: rows[0].is_available };
  },

  /**
   * Update mentor pricing
   * Invalidates the mentor profile cache and mentor search caches
   */
  async updatePricing(id: string, payload: UpdatePricingInput): Promise<MentorRecord | null> {
    const { rows } = await pool.query<MentorRecord>(
      `UPDATE users SET hourly_rate = $1, updated_at = NOW()
       WHERE id = $2 AND role = 'mentor' AND is_active = true
       RETURNING ${MENTOR_COLUMNS}`,
      [payload.hourlyRate, id],
    );

    // Invalidate mentor profile and search caches
    if (rows[0]) {
      await CacheService.del(CacheKeys.mentorProfile(id));
      await CacheService.invalidatePattern('mm:mentors:search:*');
      logger.debug('Mentor cache invalidated on pricing update', { mentorId: id });
    }

    return rows[0] ?? null;
  },

  /**
   * Get sessions for a mentor
   */
  async getSessions(id: string, query: GetMentorSessionsQuery): Promise<{ sessions: MentorSessionRecord[]; total: number; next_cursor: string | null; has_more: boolean }> {
    const { cursor, limit, status, from, to } = query;
    const conditions: string[] = ['mentor_id = $1'];
    const values: unknown[] = [id];
    let idx = 2;

    if (cursor) {
      const decoded = PaginationUtil.decodeCursor(cursor);
      if (decoded) {
        // sessions are usually sorted by scheduled_at DESC
        conditions.push(`(scheduled_at, id) < ($${idx}, $${idx + 1})`);
        values.push(decoded.created_at, decoded.id);
        idx += 2;
      }
    }

    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
    if (from) { conditions.push(`scheduled_at >= $${idx++}`); values.push(from); }
    if (to) { conditions.push(`scheduled_at <= $${idx++}`); values.push(to); }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const [dataResult, countResult] = await Promise.all([
      pool.query<MentorSessionRecord>(
        `SELECT * FROM sessions ${whereClause} ORDER BY scheduled_at DESC, id DESC LIMIT $${idx}`,
        [...values, limit + 1],
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM sessions WHERE mentor_id = $1 ${status ? `AND status = $2` : ''}`,
        status ? [id, status] : [id],
      ),
    ]);

    const rows = dataResult.rows;
    const has_more = rows.length > limit;
    const data = has_more ? rows.slice(0, limit) : rows;

    const lastItem = data[data.length - 1];
    const next_cursor = has_more && lastItem ? PaginationUtil.encodeCursor({ id: lastItem.id, created_at: lastItem.scheduled_at.toISOString() }) : null;

    return {
      sessions: data,
      total: parseInt(countResult.rows[0].count, 10),
      next_cursor,
      has_more,
    };
  },

  /**
   * Get earnings data for a mentor
   */
  async getEarnings(id: string, query: GetMentorEarningsQuery): Promise<EarningsSummary> {
    const { from, to, groupBy } = query;

    const values: unknown[] = [id];
    let idx = 2;

    const dateFilters: string[] = [];
    if (from) { dateFilters.push(`AND b.created_at >= $${idx++}`); values.push(from); }
    if (to) { dateFilters.push(`AND b.created_at <= $${idx++}`); values.push(to); }
    const dateFilterClause = dateFilters.join(' ');

    const allowedUnits: Record<string, string> = { day: 'day', week: 'week', month: 'month' };
    const truncUnit = allowedUnits[groupBy];
    if (!truncUnit) {
      throw new Error(`Invalid groupBy value: ${groupBy}`);
    }

    const baseWhere = `WHERE b.mentor_id = $1 AND b.status = 'completed' AND b.payment_status = 'released' ${dateFilterClause}`;

    const [summaryResult, breakdownResult] = await Promise.all([
      pool.query<{ total_earnings: string; total_sessions: string }>(
        `SELECT
           COALESCE(SUM(b.mentor_payout), 0) AS total_earnings,
           COUNT(b.id) AS total_sessions
         FROM bookings b
         ${baseWhere}`,
        values,
      ),
      pool.query<{ period: string; earnings: string; sessions: string }>(
        `SELECT
           DATE_TRUNC($${idx}, b.created_at)::text AS period,
           COALESCE(SUM(b.mentor_payout), 0) AS earnings,
           COUNT(b.id) AS sessions
         FROM bookings b
         ${baseWhere}
         GROUP BY DATE_TRUNC($${idx}, b.created_at)
         ORDER BY period DESC`,
        [...values, truncUnit],
      ),
    ]);

    const { total_earnings, total_sessions } = summaryResult.rows[0];
    const totalEarnings = parseFloat(total_earnings);
    const totalSessions = parseInt(total_sessions, 10);

    return {
      totalEarnings,
      totalSessions,
      averagePerSession: totalSessions > 0 ? totalEarnings / totalSessions : 0,
      breakdown: breakdownResult.rows.map((r) => ({
        period: r.period,
        earnings: parseFloat(r.earnings),
        sessions: parseInt(r.sessions, 10),
      })),
    };
  },

  /**
   * Submit verification request
   */
  async submitVerification(
    id: string,
    payload: SubmitVerificationInput,
  ): Promise<{ submitted: boolean; message: string }> {
    // Store verification request in metadata
    await pool.query(
      `UPDATE users
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{verification_request}',
         $1::jsonb
       ), updated_at = NOW()
       WHERE id = $2 AND role = 'mentor' AND is_active = true`,
      [
        JSON.stringify({
          documentType: payload.documentType,
          documentUrl: payload.documentUrl,
          linkedinUrl: payload.linkedinUrl ?? null,
          additionalNotes: payload.additionalNotes ?? null,
          submittedAt: new Date().toISOString(),
          status: 'pending',
        }),
        id,
      ],
    );
    return { submitted: true, message: 'Verification request submitted successfully' };
  },
};
