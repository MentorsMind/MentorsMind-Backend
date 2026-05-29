/**
 * Mentor Routes
 */

import { Router } from "express";
import { MentorsController } from "../controllers/mentors.controller";
import { EarningsReportController } from "../controllers/earningsReport.controller";
import { VerificationController } from "../controllers/verification.controller";
import { ReviewsController } from "../controllers/reviews.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireOwnerOrAdmin, requireRole } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validation.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { mentorIdParamSchema } from "../validators/reviews.validator";
import {
  createMentorProfileSchema,
  updateMentorProfileSchema,
  listMentorsSchema,
  setAvailabilitySchema,
  updatePricingSchema,
  getMentorSessionsSchema,
  getMentorEarningsSchema,
  submitVerificationSchema,
} from "../validators/schemas/mentors.schemas";
import {
  getEarningsSummarySchema,
  getEarningsBreakdownSchema,
  exportEarningsSchema,
  getExportStatusSchema,
  downloadExportSchema,
} from "../validators/schemas/earnings.schemas";
import { submitVerificationSchema as verificationSubmitSchema } from "../validators/schemas/verification.schemas";
import { idParamSchema } from "../validators/schemas/common.schemas";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Mentors
 *   description: Mentor profile, availability, pricing, and session management
 */

/**
 * @swagger
 * /api/v1/mentors:
 *   post:
 *     summary: Create mentor profile
 *     tags: [Mentors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [hourlyRate, expertise]
 *             properties:
 *               bio: { type: string }
 *               avatarUrl: { type: string, format: uri }
 *               hourlyRate: { type: number, minimum: 0 }
 *               expertise: { type: array, items: { type: string } }
 *               yearsOfExperience: { type: integer, minimum: 0 }
 *               timezone: { type: string }
 *     responses:
 *       201:
 *         description: Mentor profile created
 *       409:
 *         description: Profile already exists
 */
router.post(
  "/",
  authenticate,
  validate(createMentorProfileSchema),
  asyncHandler(MentorsController.createProfile),
);

/**
 * @swagger
 * /api/v1/mentors:
 *   get:
 *     summary: List mentors with filtering and pagination
 *     tags: [Mentors]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: expertise
 *         schema: { type: string }
 *       - in: query
 *         name: minRate
 *         schema: { type: number }
 *       - in: query
 *         name: maxRate
 *         schema: { type: number }
 *       - in: query
 *         name: isAvailable
 *         schema: { type: boolean }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [hourlyRate, averageRating, totalSessions, createdAt] }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc] }
 *     responses:
 *       200:
 *         description: List of mentors
 */
router.get(
  "/",
  validate(listMentorsSchema),
  asyncHandler(MentorsController.listMentors),
);

/**
 * @swagger
 * /api/v1/mentors/{id}:
 *   get:
 *     summary: Get mentor profile by ID
 *     tags: [Mentors]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Mentor profile
 *       404:
 *         description: Mentor not found
 */
router.get(
  "/:id",
  validate(idParamSchema),
  asyncHandler(MentorsController.getProfile),
);

/**
 * @swagger
 * /api/v1/mentors/{id}:
 *   put:
 *     summary: Update mentor profile
 *     tags: [Mentors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated mentor profile
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Mentor not found
 */
router.put(
  "/:id",
  authenticate,
  requireOwnerOrAdmin,
  validate(updateMentorProfileSchema),
  asyncHandler(MentorsController.updateProfile),
);

/**
 * @swagger
 * /api/v1/mentors/{id}/availability:
 *   post:
 *     summary: Set mentor availability schedule
 *     tags: [Mentors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Availability updated
 */
router.post(
  "/:id/availability",
  authenticate,
  requireOwnerOrAdmin,
  validate(setAvailabilitySchema),
  asyncHandler(MentorsController.setAvailability),
);

/**
 * @swagger
 * /api/v1/mentors/{id}/availability:
 *   get:
 *     summary: Get mentor availability
 *     tags: [Mentors]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Mentor availability schedule
 */
router.get(
  "/:id/availability",
  validate(idParamSchema),
  asyncHandler(MentorsController.getAvailability),
);

/**
 * @swagger
 * /api/v1/mentors/{id}/pricing:
 *   put:
 *     summary: Update mentor pricing
 *     tags: [Mentors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [hourlyRate]
 *             properties:
 *               hourlyRate: { type: number, minimum: 0 }
 *               currency: { type: string, example: USD }
 *     responses:
 *       200:
 *         description: Pricing updated
 */
router.put(
  "/:id/pricing",
  authenticate,
  requireOwnerOrAdmin,
  validate(updatePricingSchema),
  asyncHandler(MentorsController.updatePricing),
);

/**
 * @swagger
 * /api/v1/mentors/{id}/sessions:
 *   get:
 *     summary: Get mentor sessions
 *     tags: [Mentors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, completed, cancelled] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: List of sessions
 */
router.get(
  "/:id/sessions",
  authenticate,
  requireOwnerOrAdmin,
  validate(getMentorSessionsSchema),
  asyncHandler(MentorsController.getSessions),
);

/**
 * @swagger
 * /api/v1/mentors/{id}/earnings:
 *   get:
 *     summary: Get mentor earnings data
 *     tags: [Mentors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [day, week, month] }
 *     responses:
 *       200:
 *         description: Earnings summary and breakdown
 */
router.get(
  "/:id/earnings",
  authenticate,
  requireOwnerOrAdmin,
  validate(getMentorEarningsSchema),
  asyncHandler(MentorsController.getEarnings),
);

/**
 * @swagger
 * /api/v1/mentors/{id}/verify:
 *   post:
 *     summary: Submit mentor verification request
 *     tags: [Mentors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [documentType, documentUrl]
 *             properties:
 *               documentType: { type: string, enum: [passport, national_id, drivers_license] }
 *               documentUrl: { type: string, format: uri }
 *               linkedinUrl: { type: string, format: uri }
 *               additionalNotes: { type: string }
 *     responses:
 *       200:
 *         description: Verification request submitted
 */
router.post(
  "/:id/verify",
  authenticate,
  requireOwnerOrAdmin,
  validate(submitVerificationSchema),
  asyncHandler(MentorsController.submitVerification),
);

/**
 * @swagger
 * /api/v1/mentors/verification/submit:
 *   post:
 *     summary: Submit mentor verification documents
 *     tags: [Mentors, Verification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [documentType, documentUrl]
 *             properties:
 *               documentType: { type: string, enum: [passport, national_id, drivers_license, professional_certificate] }
 *               documentUrl: { type: string, format: uri }
 *               credentialUrl: { type: string, format: uri }
 *               linkedinUrl: { type: string, format: uri }
 *               additionalNotes: { type: string }
 *     responses:
 *       201:
 *         description: Verification submitted
 */
router.post(
  "/verification/submit",
  authenticate,
  requireRole("mentor"),
  validate(verificationSubmitSchema),
  asyncHandler(VerificationController.submit),
);

/**
 * @swagger
 * /api/v1/mentors/{id}/verification-status:
 *   get:
 *     summary: Get mentor verification status (public)
 *     tags: [Mentors, Verification]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Verification status
 *       404:
 *         description: No verification record found
 */
router.get(
  "/:id/verification-status",
  validate(idParamSchema),
  asyncHandler(VerificationController.getVerificationStatus),
);

/**
 * @swagger
 * /api/v1/mentors/{id}/rating-summary:
 *   get:
 *     summary: Get aggregated rating summary for a mentor (public)
 *     tags: [Mentors, Reviews]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Rating summary
 *       404:
 *         description: Mentor not found
 *       422:
 *         description: Validation error
 */
router.get(
  "/:id/rating-summary",
  validate(mentorIdParamSchema),
  asyncHandler(ReviewsController.getRatingSummary),
);

/**
 * @swagger
 * /api/v1/mentors/me/earnings:
 *   get:
 *     summary: Get mentor earnings summary
 *     tags: [Mentors, Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [7d, 30d, 90d, 1y], default: 30d }
 *         description: Earnings period
 *     responses:
 *       200:
 *         description: Earnings summary with gross, platform fee, net, and asset breakdown
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/me/earnings",
  authenticate,
  validate(getEarningsSummarySchema),
  asyncHandler(EarningsReportController.getEarningsSummary),
);

/**
 * @swagger
 * /api/v1/mentors/me/earnings/breakdown:
 *   get:
 *     summary: Get per-session earnings breakdown
 *     tags: [Mentors, Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Paginated list of sessions with earnings
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/me/earnings/breakdown",
  authenticate,
  validate(getEarningsBreakdownSchema),
  asyncHandler(EarningsReportController.getEarningsBreakdown),
);

/**
 * @swagger
 * /api/v1/mentors/me/earnings/export:
 *   get:
 *     summary: Export earnings as CSV or PDF
 *     tags: [Mentors, Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, pdf], default: csv }
 *         required: true
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [7d, 30d, 90d, 1y], default: 30d }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: File download (for immediate export)
 *       202:
 *         description: Export queued for processing (for large ranges)
 *       400:
 *         description: Invalid parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/me/earnings/export",
  authenticate,
  validate(exportEarningsSchema),
  asyncHandler(EarningsReportController.exportEarnings),
);

/**
 * @swagger
 * /api/v1/mentors/me/earnings/export/{jobId}/status:
 *   get:
 *     summary: Check status of queued export job
 *     tags: [Mentors, Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Export job status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not job owner)
 *       404:
 *         description: Job not found
 *       500:
 *         description: Server error
 */
router.get(
  "/me/earnings/export/:jobId/status",
  authenticate,
  validate(getExportStatusSchema),
  asyncHandler(EarningsReportController.getExportStatus),
);

/**
 * @swagger
 * /api/v1/mentors/me/earnings/export/{jobId}/download:
 *   get:
 *     summary: Download completed export
 *     tags: [Mentors, Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: File download
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not job owner)
 *       404:
 *         description: Job not found
 *       410:
 *         description: Download link expired
 *       500:
 *         description: Server error
 */
router.get(
  "/me/earnings/export/:jobId/download",
  authenticate,
  validate(downloadExportSchema),
  asyncHandler(EarningsReportController.downloadExport),
);

export default router;
