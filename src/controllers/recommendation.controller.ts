/**
 * Recommendation Controller - Mentor Recommendation Engine API
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { RecommendationService } from '../services/recommendation.service';
import { ResponseUtil } from '../utils/response.utils';

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
        const { mentorId } = req.params;
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
        const { mentorId } = req.params;
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
};