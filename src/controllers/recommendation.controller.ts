/**
 * Recommendation Controller - Mentor Recommendation Engine API
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { RecommendationService } from '../services/recommendation.service';
import { ResponseUtil } from '../utils/response.utils';

const FEEDBACK_EVENT_TYPES = new Set(['click', 'dismiss']);

export const RecommendationController = {
    async getMentorRecommendations(
        req: AuthenticatedRequest,
        res: Response,
    ): Promise<void> {
        const learnerId = req.user!.id;
        const limit = parseInt(req.query.limit as string) || 5;

        if (limit < 1 || limit > 10) {
            ResponseUtil.error(res, 'Limit must be between 1 and 10', 400);
            return;
        }

        try {
            const recommendations = await RecommendationService.getRecommendedMentors(learnerId, limit);
            ResponseUtil.success(res, recommendations, 'Recommendations retrieved successfully');
        } catch (error) {
            ResponseUtil.error(
                res,
                'Failed to retrieve recommendations',
                500,
                error instanceof Error ? error.message : undefined,
            );
        }
    },

    async dismissMentor(
        req: AuthenticatedRequest,
        res: Response,
    ): Promise<void> {
        const learnerId = req.user!.id;
        const { mentorId } = req.params as Record<string, string>;
        const { reason } = req.body;

        if (!mentorId) {
            ResponseUtil.error(res, 'Mentor ID is required', 400);
            return;
        }

        try {
            await RecommendationService.dismissMentor(learnerId, mentorId, reason);
            ResponseUtil.success(res, null, 'Mentor dismissed successfully');
        } catch (error) {
            ResponseUtil.error(
                res,
                'Failed to dismiss mentor',
                500,
                error instanceof Error ? error.message : undefined,
            );
        }
    },

    async logRecommendationClick(
        req: AuthenticatedRequest,
        res: Response,
    ): Promise<void> {
        const learnerId = req.user!.id;
        const { mentorId } = req.params as Record<string, string>;
        const { position, context, scoring } = req.body;

        if (!mentorId) {
            ResponseUtil.error(res, 'Mentor ID is required', 400);
            return;
        }

        try {
            await RecommendationService.logEvent({
                event_type: 'click',
                learner_id: learnerId,
                mentor_id: mentorId,
                position: position || 0,
                context: context || { goals: [], session_history_count: 0, skill_gaps: [] },
                scoring: scoring || {
                    skill_match_score: 0,
                    rating_score: 0,
                    availability_score: 0,
                    price_fit_score: 0,
                    collaborative_score: 0,
                    total_score: 0,
                },
            });
            ResponseUtil.success(res, null, 'Click logged successfully');
        } catch (error) {
            ResponseUtil.error(
                res,
                'Failed to log click',
                500,
                error instanceof Error ? error.message : undefined,
            );
        }
    },

    /**
     * GET /api/v1/recommendations/feedback
     * Fast feedback endpoint for frontend click/dismiss logging (<100ms target).
     * Query: event_type=click|dismiss&mentor_id=<uuid>&position=<n>&reason=<string>
     */
    async logFeedback(
        req: AuthenticatedRequest,
        res: Response,
    ): Promise<void> {
        const startedAt = Date.now();
        const learnerId = req.user!.id;
        const eventType = String(req.query.event_type || '').toLowerCase();
        const mentorId = String(req.query.mentor_id || '');
        const positionRaw = req.query.position;
        const reason = req.query.reason ? String(req.query.reason) : undefined;
        const sessionId = req.query.session_id ? String(req.query.session_id) : undefined;

        if (!FEEDBACK_EVENT_TYPES.has(eventType)) {
            ResponseUtil.error(res, 'event_type must be click or dismiss', 400);
            return;
        }

        if (!mentorId) {
            ResponseUtil.error(res, 'mentor_id is required', 400);
            return;
        }

        const position = positionRaw !== undefined
            ? parseInt(String(positionRaw), 10)
            : undefined;

        if (position !== undefined && Number.isNaN(position)) {
            ResponseUtil.error(res, 'position must be a number', 400);
            return;
        }

        try {
            await RecommendationService.logFeedback({
                event_type: eventType as 'click' | 'dismiss',
                learner_id: learnerId,
                mentor_id: mentorId,
                position,
                reason,
                session_id: sessionId,
            });

            const durationMs = Date.now() - startedAt;
            ResponseUtil.success(
                res,
                { logged: true, duration_ms: durationMs },
                'Feedback logged successfully',
            );
        } catch (error) {
            ResponseUtil.error(
                res,
                'Failed to log feedback',
                500,
                error instanceof Error ? error.message : undefined,
            );
        }
    },
};
