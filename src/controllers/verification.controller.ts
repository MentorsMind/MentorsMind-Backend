/**
 * Verification Controller — Issue #103
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { VerificationService } from '../services/verification.service';
import { ResponseUtil } from '../utils/response.utils';

export const VerificationController = {
    /**
     * POST /mentors/verification/submit
     * Mentor submits ID + credential docs.
     */
    async submit(req: AuthenticatedRequest, res: Response): Promise<void> {
        const mentorId = req.user!.id;
        const { documentType, documentUrl, credentialUrl, linkedinUrl, additionalNotes } = req.body;

        const verification = await VerificationService.submit(mentorId, {
            documentType,
            documentUrl,
            credentialUrl,
            linkedinUrl,
            additionalNotes,
        });

        ResponseUtil.created(res, verification, 'Verification submitted successfully');
    },

    /**
     * GET /admin/verifications
     * Admin list of all verifications (filterable by status).
     */
    async listVerifications(req: AuthenticatedRequest, res: Response): Promise<void> {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const status = req.query.status as any;

        const result = await VerificationService.list({ status, page, limit });

        ResponseUtil.success(res, result.verifications, 'Verifications retrieved successfully', 200, {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
            hasNext: result.page < result.totalPages,
            hasPrev: result.page > 1,
        });
    },

    /**
     * PUT /admin/verifications/:id/approve
     */
    async approve(req: AuthenticatedRequest, res: Response): Promise<void> {
        const verification = await VerificationService.approve(req.params.id, req.user!.id);
        ResponseUtil.success(res, verification, 'Verification approved');
    },

    /**
     * PUT /admin/verifications/:id/reject
     */
    async reject(req: AuthenticatedRequest, res: Response): Promise<void> {
        const { reason } = req.body;
        if (!reason) {
            ResponseUtil.error(res, 'Rejection reason is required', 400);
            return;
        }
        const verification = await VerificationService.reject(req.params.id, req.user!.id, reason);
        ResponseUtil.success(res, verification, 'Verification rejected');
    },

    /**
     * PUT /admin/verifications/:id/request-more
     */
    async requestMoreInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
        const { message } = req.body;
        if (!message) {
            ResponseUtil.error(res, 'A message describing the required information is required', 400);
            return;
        }
        const verification = await VerificationService.requestMoreInfo(
            req.params.id,
            req.user!.id,
            message,
        );
        ResponseUtil.success(res, verification, 'Additional information requested');
    },

    /**
     * GET /mentors/:id/verification-status
     * Public endpoint — returns latest verification status for a mentor.
     */
    async getVerificationStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        const verification = await VerificationService.getStatusByMentorId(req.params.id);
        if (!verification) {
            ResponseUtil.notFound(res, 'No verification record found for this mentor');
            return;
        }
        // Strip sensitive admin fields from public response
        const { rejection_reason: _r, additional_info_request: _a, reviewed_by: _rb, ...publicData } = verification;
        ResponseUtil.success(res, publicData, 'Verification status retrieved');
    },
};
