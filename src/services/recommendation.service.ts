/**
 * Recommendation Service - Mentor Recommendation Engine
 * Scores and recommends mentors to learners based on:
 * - Skill match with learner goals (40%)
 * - Rating (30%)
 * - Availability (20%)
 * - Price fit (10%)
 */

import pool from '../config/database';
import { CacheService } from './cache.service';
import { CacheKeys, CacheTTL } from '../utils/cache-key.utils';
import { logger } from '../utils/logger.utils';

const RECOMMENDATION_CACHE_TTL = CacheTTL.long;

export interface MentorRecommendation {
    mentor_id: string;
    first_name: string;
    last_name: string;
    email: string;
    bio: string | null;
    avatar_url: string | null;
    expertise: string[] | null;
    hourly_rate: number | null;
    average_rating: number;
    total_reviews: number;
    total_sessions_completed: number;
    is_available: boolean;
    timezone: string | null;
    score_breakdown: {
        skill_match_score: number;
        rating_score: number;
        availability_score: number;
        price_fit_score: number;
        total_score: number;
    };
}

export interface RecommendationContext {
    goals: string[];
    session_history_count: number;
    skill_gaps: string[];
    learner_preferred_price_range?: { min: number; max: number };
}

export interface RecommendationEvent {
    event_type: 'impression' | 'click' | 'dismiss';
    learner_id: string;
    mentor_id: string;
    position: number;
    context: RecommendationContext;
    scoring: MentorRecommendation['score_breakdown'];
    session_id?: string;
}

class RecommendationServiceImpl {
    async initialize(): Promise<void> {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS recommendation_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_type VARCHAR(20) NOT NULL,
                learner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                context JSONB DEFAULT '{}'::jsonb,
                scoring JSONB DEFAULT '{}'::jsonb,
                position INTEGER,
                booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
                session_id VARCHAR(255),
                user_agent TEXT,
                ip_address VARCHAR(45),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_recommendation_events_learner_id ON recommendation_events(learner_id);
            CREATE INDEX IF NOT EXISTS idx_recommendation_events_event_type ON recommendation_events(event_type);

            CREATE TABLE IF NOT EXISTS dismissed_recommendations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                learner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                reason VARCHAR(255),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                CONSTRAINT unique_dismissed_mentor UNIQUE (learner_id, mentor_id)
            );

            CREATE INDEX IF NOT EXISTS idx_dismissed_recommendations_learner_id ON dismissed_recommendations(learner_id);
        `);
        logger.info('[RecommendationService] Initialized recommendation tables');
    }

    async getRecommendedMentors(learnerId: string, limit = 5): Promise<MentorRecommendation[]> {
        const cacheKey = CacheKeys.recommendationMentors(learnerId);
        const cached = await CacheService.get<MentorRecommendation[]>(cacheKey);
        if (cached) {
            logger.debug('[RecommendationService] Returning cached recommendations', { learnerId });
            return cached;
        }

        const context = await this.buildLearnerContext(learnerId);
        const dismissedMentorIds = await this.getDismissedMentorIds(learnerId);
        const bookedMentorIds = await this.getBookedMentorIds(learnerId, 3);

        const excludeIds = [...new Set([...dismissedMentorIds, ...bookedMentorIds])];

        const mentors = await this.scoreMentors(learnerId, context, excludeIds);
        const recommendations = mentors.slice(0, limit);

        await CacheService.set(cacheKey, recommendations, RECOMMENDATION_CACHE_TTL);

        await this.logImpressions(learnerId, recommendations, context);

        return recommendations;
    }

    private async buildLearnerContext(learnerId: string): Promise<RecommendationContext> {
        const { rows: goalsRows } = await pool.query<{ goal_title: string }>(
            `SELECT goal_title FROM goals WHERE learner_id = $1 AND status = 'active'`,
            [learnerId],
        );

        const { rows: historyRows } = await pool.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM bookings WHERE mentee_id = $1 AND status = 'completed'`,
            [learnerId],
        );

        const goals = goalsRows.map(r => r.goal_title);
        const session_history_count = parseInt(historyRows[0]?.count || '0', 10);

        const skill_gaps = this.identifySkillGaps(goals);

        return { goals, session_history_count, skill_gaps };
    }

    private identifySkillGaps(goals: string[]): string[] {
        return goals.map(g => g.toLowerCase()).filter(g => !goals.includes(g));
    }

    private async getDismissedMentorIds(learnerId: string): Promise<string[]> {
        const { rows } = await pool.query<{ mentor_id: string }>(
            `SELECT mentor_id FROM dismissed_recommendations WHERE learner_id = $1`,
            [learnerId],
        );
        return rows.map(r => r.mentor_id);
    }

    private async getBookedMentorIds(learnerId: string, minSessions: number): Promise<string[]> {
        const { rows } = await pool.query<{ mentor_id: string }>(
            `SELECT mentor_id FROM bookings
             WHERE mentee_id = $1 AND status IN ('completed', 'confirmed')
             GROUP BY mentor_id
             HAVING COUNT(*) >= $2`,
            [learnerId, minSessions],
        );
        return rows.map(r => r.mentor_id);
    }

    private async scoreMentors(
        learnerId: string,
        context: RecommendationContext,
        excludeIds: string[]
    ): Promise<MentorRecommendation[]> {
        const excludeClause = excludeIds.length > 0
            ? `AND id NOT IN (${excludeIds.map((_, i) => `$${i + 3}`).join(', ')})`
            : '';

        const learnerPreferredPrice = context.goals.length > 0
            ? await this.getLearnerPricePreference(learnerId)
            : null;

        const { rows: mentors } = await pool.query<any>(
            `SELECT id, email, first_name, last_name, bio, avatar_url, expertise,
                    hourly_rate, average_rating, total_reviews, total_sessions_completed,
                    is_available, timezone
             FROM users
             WHERE role = 'mentor'
               AND is_active = true
               AND average_rating >= 4.0
               AND is_available = true
               ${excludeClause}`,
            excludeIds.length > 0 ? excludeIds : [],
        );

        const scoredMentors: MentorRecommendation[] = mentors.map(mentor => {
            const skill_match_score = this.calculateSkillMatchScore(mentor.expertise, context);
            const rating_score = this.calculateRatingScore(mentor.average_rating);
            const availability_score = this.calculateAvailabilityScore(mentor.is_available, mentor.timezone);
            const price_fit_score = this.calculatePriceFitScore(
                mentor.hourly_rate,
                learnerPreferredPrice
            );

            const total_score =
                (skill_match_score * 0.4) +
                (rating_score * 0.3) +
                (availability_score * 0.2) +
                (price_fit_score * 0.1);

            return {
                mentor_id: mentor.id,
                first_name: mentor.first_name,
                last_name: mentor.last_name,
                email: mentor.email,
                bio: mentor.bio,
                avatar_url: mentor.avatar_url,
                expertise: mentor.expertise,
                hourly_rate: mentor.hourly_rate,
                average_rating: parseFloat(mentor.average_rating) || 0,
                total_reviews: mentor.total_reviews || 0,
                total_sessions_completed: mentor.total_sessions_completed || 0,
                is_available: mentor.is_available,
                timezone: mentor.timezone,
                score_breakdown: {
                    skill_match_score: Math.round(skill_match_score * 100) / 100,
                    rating_score: Math.round(rating_score * 100) / 100,
                    availability_score: Math.round(availability_score * 100) / 100,
                    price_fit_score: Math.round(price_fit_score * 100) / 100,
                    total_score: Math.round(total_score * 100) / 100,
                },
            };
        });

        return scoredMentors.sort((a, b) => b.score_breakdown.total_score - a.score_breakdown.total_score);
    }

    private calculateSkillMatchScore(mentorExpertise: string[] | null, context: RecommendationContext): number {
        if (!mentorExpertise || mentorExpertise.length === 0 || context.goals.length === 0) {
            return 0.3;
        }

        const expertiseLower = mentorExpertise.map(e => e.toLowerCase());
        const goalsLower = context.goals.map(g => g.toLowerCase());

        const matchCount = goalsLower.filter(goal =>
            expertiseLower.some(exp => exp.includes(goal) || goal.includes(exp))
        ).length;

        const maxPossible = Math.max(goalsLower.length, 1);
        return Math.min(matchCount / maxPossible, 1.0);
    }

    private calculateRatingScore(averageRating: number): number {
        return Math.min(Math.max(averageRating / 5.0, 0), 1.0);
    }

    private calculateAvailabilityScore(isAvailable: boolean, timezone: string | null): number {
        if (!isAvailable) return 0;
        return timezone ? 0.9 : 0.7;
    }

    private calculatePriceFitScore(
        mentorRate: number | null,
        learnerPreferred: { min: number; max: number } | null
    ): number {
        if (!mentorRate || !learnerPreferred) return 0.5;

        if (mentorRate >= learnerPreferred.min && mentorRate <= learnerPreferred.max) {
            return 1.0;
        }

        const distance = Math.min(
            Math.abs(mentorRate - learnerPreferred.min),
            Math.abs(mentorRate - learnerPreferred.max)
        );

        return Math.max(0, 1 - (distance / 50));
    }

    private async getLearnerPricePreference(learnerId: string): Promise<{ min: number; max: number } | null> {
        const { rows } = await pool.query<{ avg_rate: string }>(
            `SELECT AVG(b.amount) as avg_rate
             FROM bookings b
             WHERE b.mentee_id = $1 AND b.status IN ('completed', 'confirmed')`,
            [learnerId],
        );

        const avgRate = parseFloat(rows[0]?.avg_rate || '0');
        if (avgRate === 0) return null;

        return {
            min: Math.max(0, avgRate * 0.7),
            max: avgRate * 1.3,
        };
    }

    private async logImpressions(
        learnerId: string,
        recommendations: MentorRecommendation[],
        context: RecommendationContext
    ): Promise<void> {
        try {
            const values: unknown[] = [];
            const placeholders: string[] = [];
            let idx = 1;

            for (const rec of recommendations) {
                placeholders.push(
                    `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
                );
                values.push(
                    'impression',
                    learnerId,
                    rec.mentor_id,
                    JSON.stringify(context),
                    JSON.stringify(rec.score_breakdown),
                    recommendations.indexOf(rec) + 1
                );
            }

            if (placeholders.length > 0) {
                await pool.query(
                    `INSERT INTO recommendation_events
                     (event_type, learner_id, mentor_id, context, scoring, position)
                     VALUES ${placeholders.join(', ')}`,
                    values,
                );
                logger.debug('[RecommendationService] Logged impressions', {
                    learnerId,
                    count: recommendations.length
                });
            }
        } catch (err) {
            logger.error('[RecommendationService] Failed to log impressions', {
                learnerId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async logEvent(event: RecommendationEvent): Promise<void> {
        try {
            await pool.query(
                `INSERT INTO recommendation_events
                 (event_type, learner_id, mentor_id, context, scoring, position, session_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    event.event_type,
                    event.learner_id,
                    event.mentor_id,
                    JSON.stringify(event.context),
                    JSON.stringify(event.scoring),
                    event.position,
                    event.session_id || null,
                ],
            );
            logger.debug('[RecommendationService] Logged event', {
                event_type: event.event_type,
                learner_id: event.learner_id,
                mentor_id: event.mentor_id,
            });
        } catch (err) {
            logger.error('[RecommendationService] Failed to log event', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async dismissMentor(learnerId: string, mentorId: string, reason?: string): Promise<void> {
        await pool.query(
            `INSERT INTO dismissed_recommendations (learner_id, mentor_id, reason)
             VALUES ($1, $2, $3)
             ON CONFLICT (learner_id, mentor_id) DO UPDATE SET reason = $3, created_at = NOW()`,
            [learnerId, mentorId, reason || null],
        );

        const cacheKey = CacheKeys.recommendationMentors(learnerId);
        await CacheService.del(cacheKey);

        await pool.query(
            `INSERT INTO recommendation_events
             (event_type, learner_id, mentor_id, context, scoring, position)
             VALUES ('dismiss', $1, $2, '{}', '{}', NULL)`,
            [learnerId, mentorId],
        );

        logger.info('[RecommendationService] Mentor dismissed', { learnerId, mentorId, reason });
    }
}

CacheKeys.recommendationMentors = (learnerId: string) => `mm:recommendations:${learnerId}`;

export const RecommendationService = new RecommendationServiceImpl();