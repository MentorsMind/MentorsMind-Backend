import pool from '../config/database'
import { CacheService } from './cache.service'
import { logger } from '../utils/logger'

// ─── TTL Constants ────────────────────────────────────────────────────────────

const REALTIME_TTL_SECONDS = 90 // 1.5 minutes — short enough to feel near-real-time

// ─── Result Interfaces ────────────────────────────────────────────────────────

export interface RealtimeRevenueResult {
  totalRevenue: number
  transactionCount: number
  avgTransactionValue: number
  completedCount: number
  pendingCount: number
  windowMinutes: number
  computedAt: string
}

export interface RealtimeSessionStats {
  totalBookings: number
  confirmedBookings: number
  pendingBookings: number
  cancelledBookings: number
  completedBookings: number
  uniqueMentors: number
  uniqueMentees: number
  windowMinutes: number
  computedAt: string
}

export interface RealtimeUserGrowth {
  newUsers: number
  newMentors: number
  newMentees: number
  windowMinutes: number
  computedAt: string
}

export interface TopMentorRealtime {
  mentorId: string
  fullName: string
  sessionCount: number
  avgRating: number | null
  totalRevenue: number
}

export interface RealtimeDashboard {
  revenue: RealtimeRevenueResult
  sessions: RealtimeSessionStats
  userGrowth: RealtimeUserGrowth
  topMentors: TopMentorRealtime[]
  windowMinutes: number
  computedAt: string
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class RealtimeAnalyticsService {
  /**
   * Returns revenue aggregates for the last `windowMinutes` minutes,
   * querying base tables directly (bypassing materialized views).
   * Results are cached in Redis for REALTIME_TTL_SECONDS.
   */
  static async getRealtimeRevenue(
    windowMinutes = 15,
  ): Promise<RealtimeRevenueResult> {
    const cacheKey = `analytics:realtime:revenue:w${windowMinutes}`

    try {
      const cached = await CacheService.get<RealtimeRevenueResult>(cacheKey)
      if (cached) return cached
    } catch (cacheErr) {
      logger.warn('RealtimeAnalytics: cache get failed for revenue', { error: cacheErr })
    }

    try {
      const { rows } = await pool.query(
        `SELECT
           COALESCE(SUM(amount), 0)::float                     AS "totalRevenue",
           COUNT(*)::int                                        AS "transactionCount",
           COALESCE(AVG(amount), 0)::float                     AS "avgTransactionValue",
           COUNT(*) FILTER (WHERE status = 'completed')::int   AS "completedCount",
           COUNT(*) FILTER (WHERE status = 'pending')::int     AS "pendingCount"
         FROM transactions
         WHERE created_at >= NOW() - ($1 || ' minutes')::interval`,
        [windowMinutes],
      )

      const result: RealtimeRevenueResult = {
        totalRevenue: Number(rows[0]?.totalRevenue ?? 0),
        transactionCount: Number(rows[0]?.transactionCount ?? 0),
        avgTransactionValue: Number(rows[0]?.avgTransactionValue ?? 0),
        completedCount: Number(rows[0]?.completedCount ?? 0),
        pendingCount: Number(rows[0]?.pendingCount ?? 0),
        windowMinutes,
        computedAt: new Date().toISOString(),
      }

      await CacheService.set(cacheKey, result, REALTIME_TTL_SECONDS)
      return result
    } catch (err) {
      logger.error('RealtimeAnalytics: getRealtimeRevenue query failed', { error: err, windowMinutes })
      // Graceful fallback — return zeroed result rather than propagating error
      return {
        totalRevenue: 0,
        transactionCount: 0,
        avgTransactionValue: 0,
        completedCount: 0,
        pendingCount: 0,
        windowMinutes,
        computedAt: new Date().toISOString(),
      }
    }
  }

  /**
   * Returns booking/session stats for the last `windowMinutes` minutes.
   */
  static async getRealtimeSessionStats(
    windowMinutes = 15,
  ): Promise<RealtimeSessionStats> {
    const cacheKey = `analytics:realtime:sessions:w${windowMinutes}`

    try {
      const cached = await CacheService.get<RealtimeSessionStats>(cacheKey)
      if (cached) return cached
    } catch (cacheErr) {
      logger.warn('RealtimeAnalytics: cache get failed for sessions', { error: cacheErr })
    }

    try {
      const { rows } = await pool.query(
        `SELECT
           COUNT(*)::int                                              AS "totalBookings",
           COUNT(*) FILTER (WHERE status = 'confirmed')::int         AS "confirmedBookings",
           COUNT(*) FILTER (WHERE status = 'pending')::int           AS "pendingBookings",
           COUNT(*) FILTER (WHERE status = 'cancelled')::int         AS "cancelledBookings",
           COUNT(*) FILTER (WHERE status = 'completed')::int         AS "completedBookings",
           COUNT(DISTINCT mentor_id)::int                            AS "uniqueMentors",
           COUNT(DISTINCT mentee_id)::int                            AS "uniqueMentees"
         FROM bookings
         WHERE created_at >= NOW() - ($1 || ' minutes')::interval`,
        [windowMinutes],
      )

      const result: RealtimeSessionStats = {
        totalBookings: Number(rows[0]?.totalBookings ?? 0),
        confirmedBookings: Number(rows[0]?.confirmedBookings ?? 0),
        pendingBookings: Number(rows[0]?.pendingBookings ?? 0),
        cancelledBookings: Number(rows[0]?.cancelledBookings ?? 0),
        completedBookings: Number(rows[0]?.completedBookings ?? 0),
        uniqueMentors: Number(rows[0]?.uniqueMentors ?? 0),
        uniqueMentees: Number(rows[0]?.uniqueMentees ?? 0),
        windowMinutes,
        computedAt: new Date().toISOString(),
      }

      await CacheService.set(cacheKey, result, REALTIME_TTL_SECONDS)
      return result
    } catch (err) {
      logger.error('RealtimeAnalytics: getRealtimeSessionStats query failed', { error: err, windowMinutes })
      return {
        totalBookings: 0,
        confirmedBookings: 0,
        pendingBookings: 0,
        cancelledBookings: 0,
        completedBookings: 0,
        uniqueMentors: 0,
        uniqueMentees: 0,
        windowMinutes,
        computedAt: new Date().toISOString(),
      }
    }
  }

  /**
   * Returns user registration growth for the last `windowMinutes` minutes.
   */
  static async getRealtimeUserGrowth(
    windowMinutes = 15,
  ): Promise<RealtimeUserGrowth> {
    const cacheKey = `analytics:realtime:users:w${windowMinutes}`

    try {
      const cached = await CacheService.get<RealtimeUserGrowth>(cacheKey)
      if (cached) return cached
    } catch (cacheErr) {
      logger.warn('RealtimeAnalytics: cache get failed for users', { error: cacheErr })
    }

    try {
      const { rows } = await pool.query(
        `SELECT
           COUNT(*)::int                                         AS "newUsers",
           COUNT(*) FILTER (WHERE role = 'mentor')::int         AS "newMentors",
           COUNT(*) FILTER (WHERE role = 'mentee')::int         AS "newMentees"
         FROM users
         WHERE created_at >= NOW() - ($1 || ' minutes')::interval`,
        [windowMinutes],
      )

      const result: RealtimeUserGrowth = {
        newUsers: Number(rows[0]?.newUsers ?? 0),
        newMentors: Number(rows[0]?.newMentors ?? 0),
        newMentees: Number(rows[0]?.newMentees ?? 0),
        windowMinutes,
        computedAt: new Date().toISOString(),
      }

      await CacheService.set(cacheKey, result, REALTIME_TTL_SECONDS)
      return result
    } catch (err) {
      logger.error('RealtimeAnalytics: getRealtimeUserGrowth query failed', { error: err, windowMinutes })
      return {
        newUsers: 0,
        newMentors: 0,
        newMentees: 0,
        windowMinutes,
        computedAt: new Date().toISOString(),
      }
    }
  }

  /**
   * Returns top mentors ranked by session count in the last `windowMinutes` minutes.
   */
  static async getTopMentorsRealtime(
    windowMinutes = 15,
    limit = 10,
  ): Promise<TopMentorRealtime[]> {
    const cacheKey = `analytics:realtime:top-mentors:w${windowMinutes}:l${limit}`

    try {
      const cached = await CacheService.get<TopMentorRealtime[]>(cacheKey)
      if (cached) return cached
    } catch (cacheErr) {
      logger.warn('RealtimeAnalytics: cache get failed for top mentors', { error: cacheErr })
    }

    try {
      const { rows } = await pool.query(
        `SELECT
           b.mentor_id                          AS "mentorId",
           COALESCE(u.full_name, u.email, b.mentor_id::text) AS "fullName",
           COUNT(b.id)::int                     AS "sessionCount",
           AVG(r.rating)::float                 AS "avgRating",
           COALESCE(SUM(t.amount), 0)::float    AS "totalRevenue"
         FROM bookings b
         LEFT JOIN users u
           ON u.id = b.mentor_id
         LEFT JOIN reviews r
           ON r.mentor_id = b.mentor_id
           AND r.created_at >= NOW() - ($1 || ' minutes')::interval
         LEFT JOIN transactions t
           ON t.booking_id = b.id
           AND t.status = 'completed'
         WHERE b.created_at >= NOW() - ($1 || ' minutes')::interval
         GROUP BY b.mentor_id, u.full_name, u.email
         ORDER BY "sessionCount" DESC
         LIMIT $2`,
        [windowMinutes, limit],
      )

      const result: TopMentorRealtime[] = rows.map((row) => ({
        mentorId: row.mentorId,
        fullName: row.fullName,
        sessionCount: Number(row.sessionCount),
        avgRating: row.avgRating !== null ? Number(row.avgRating) : null,
        totalRevenue: Number(row.totalRevenue),
      }))

      await CacheService.set(cacheKey, result, REALTIME_TTL_SECONDS)
      return result
    } catch (err) {
      logger.error('RealtimeAnalytics: getTopMentorsRealtime query failed', { error: err, windowMinutes })
      return []
    }
  }

  /**
   * Aggregates all realtime metrics into a single dashboard response.
   */
  static async getRealtimeDashboard(windowMinutes = 15): Promise<RealtimeDashboard> {
    const cacheKey = `analytics:realtime:dashboard:w${windowMinutes}`

    try {
      const cached = await CacheService.get<RealtimeDashboard>(cacheKey)
      if (cached) return cached
    } catch (cacheErr) {
      logger.warn('RealtimeAnalytics: cache get failed for dashboard', { error: cacheErr })
    }

    // Fetch all sub-metrics in parallel for efficiency
    const [revenue, sessions, userGrowth, topMentors] = await Promise.all([
      RealtimeAnalyticsService.getRealtimeRevenue(windowMinutes),
      RealtimeAnalyticsService.getRealtimeSessionStats(windowMinutes),
      RealtimeAnalyticsService.getRealtimeUserGrowth(windowMinutes),
      RealtimeAnalyticsService.getTopMentorsRealtime(windowMinutes),
    ])

    const dashboard: RealtimeDashboard = {
      revenue,
      sessions,
      userGrowth,
      topMentors,
      windowMinutes,
      computedAt: new Date().toISOString(),
    }

    try {
      await CacheService.set(cacheKey, dashboard, REALTIME_TTL_SECONDS)
    } catch (cacheErr) {
      logger.warn('RealtimeAnalytics: cache set failed for dashboard', { error: cacheErr })
    }

    return dashboard
  }

  // ─── Incremental Aggregate Push Methods ────────────────────────────────────
  // These are called from analytics-pipeline.worker.ts event hooks to push
  // lightweight incremental aggregates into Redis immediately when a row changes,
  // providing sub-second freshness for counters that don't need full SQL re-reads.

  /**
   * Fetches the latest transaction row and increments the Redis revenue counter.
   */
  static async updateRealtimeRevenueAggregate(transactionId: string): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT id, amount, status FROM transactions WHERE id = $1`,
        [transactionId],
      )
      if (rows.length === 0) return

      const tx = rows[0]
      if (tx.status !== 'completed') return

      // Increment a lightweight rolling counter keyed by hour bucket
      const hourBucket = new Date().toISOString().substring(0, 13) // e.g. "2026-07-26T17"
      const counterKey = `analytics:realtime:incr:revenue:${hourBucket}`
      const countKey = `analytics:realtime:incr:count:${hourBucket}`

      // Use CacheService.get/set for compatibility with the in-memory fallback
      const currentTotal = (await CacheService.get<number>(counterKey)) ?? 0
      const currentCount = (await CacheService.get<number>(countKey)) ?? 0

      await CacheService.set(counterKey, currentTotal + Number(tx.amount), 7200) // 2h TTL
      await CacheService.set(countKey, currentCount + 1, 7200)

      // Invalidate the short-lived realtime cache so next read gets fresh data
      await RealtimeAnalyticsService.invalidateRealtimeCache('transactions')

      logger.debug('RealtimeAnalytics: revenue aggregate updated', {
        transactionId,
        amount: tx.amount,
        hourBucket,
      })
    } catch (err) {
      logger.warn('RealtimeAnalytics: updateRealtimeRevenueAggregate failed', {
        error: err,
        transactionId,
      })
    }
  }

  /**
   * Fetches the latest booking row and increments the Redis session counter.
   */
  static async updateRealtimeSessionAggregate(bookingId: string): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT id, status, mentor_id FROM bookings WHERE id = $1`,
        [bookingId],
      )
      if (rows.length === 0) return

      const booking = rows[0]
      const hourBucket = new Date().toISOString().substring(0, 13)
      const statusKey = `analytics:realtime:incr:bookings:${booking.status}:${hourBucket}`

      const current = (await CacheService.get<number>(statusKey)) ?? 0
      await CacheService.set(statusKey, current + 1, 7200)

      await RealtimeAnalyticsService.invalidateRealtimeCache('bookings')

      logger.debug('RealtimeAnalytics: session aggregate updated', {
        bookingId,
        status: booking.status,
        hourBucket,
      })
    } catch (err) {
      logger.warn('RealtimeAnalytics: updateRealtimeSessionAggregate failed', {
        error: err,
        bookingId,
      })
    }
  }

  /**
   * Fetches the latest user row and increments the Redis user-growth counter.
   */
  static async updateRealtimeUserAggregate(userId: string): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT id, role FROM users WHERE id = $1`,
        [userId],
      )
      if (rows.length === 0) return

      const user = rows[0]
      const hourBucket = new Date().toISOString().substring(0, 13)
      const roleKey = `analytics:realtime:incr:users:${user.role}:${hourBucket}`

      const current = (await CacheService.get<number>(roleKey)) ?? 0
      await CacheService.set(roleKey, current + 1, 7200)

      await RealtimeAnalyticsService.invalidateRealtimeCache('users')

      logger.debug('RealtimeAnalytics: user aggregate updated', {
        userId,
        role: user.role,
        hourBucket,
      })
    } catch (err) {
      logger.warn('RealtimeAnalytics: updateRealtimeUserAggregate failed', {
        error: err,
        userId,
      })
    }
  }

  /**
   * Purges all realtime cache keys associated with the given table so that the
   * next read executes a fresh SQL query against the base table.
   */
  static async invalidateRealtimeCache(table: string): Promise<void> {
    try {
      switch (table) {
        case 'transactions':
          await CacheService.invalidate('analytics:realtime:revenue:*')
          await CacheService.invalidate('analytics:realtime:dashboard:*')
          break
        case 'bookings':
          await CacheService.invalidate('analytics:realtime:sessions:*')
          await CacheService.invalidate('analytics:realtime:top-mentors:*')
          await CacheService.invalidate('analytics:realtime:dashboard:*')
          break
        case 'users':
          await CacheService.invalidate('analytics:realtime:users:*')
          await CacheService.invalidate('analytics:realtime:dashboard:*')
          break
        case 'reviews':
          await CacheService.invalidate('analytics:realtime:top-mentors:*')
          await CacheService.invalidate('analytics:realtime:dashboard:*')
          break
        default:
          // For unknown tables, purge the whole realtime namespace
          await CacheService.invalidate('analytics:realtime:*')
      }
      logger.debug('RealtimeAnalytics: cache invalidated', { table })
    } catch (err) {
      logger.warn('RealtimeAnalytics: invalidateRealtimeCache failed', { error: err, table })
    }
  }
}
