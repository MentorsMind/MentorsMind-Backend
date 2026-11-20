import { Router } from "express";
import { BulkController } from "../controllers/bulk.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { bulkPaymentsSchema, bulkJobIdParamSchema } from "../validators/schemas/bulk.schemas";
import {
  cleanupUploadedFile,
  createFileUpload,
} from "../middleware/file-upload.middleware";

const router = Router();
const upload = createFileUpload({
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(authenticate, requireAdmin);

router.post(
  "/users/import",
  upload.single("file"),
  cleanupUploadedFile,
  asyncHandler(BulkController.importUsers),
);

/**
 * @openapi
 * /admin/bulk/mentors/import:
 *   post:
 *     summary: Bulk import mentors from a CSV file
 *     description: |
 *       Upload a CSV file to create multiple mentor accounts in a single background job.
 *       Required columns: email, firstname, lastname.
 *       Optional columns: bio, expertise (comma-separated), hourlyrate, currency, timezone, linkedinurl, yearsexperience.
 *     tags: [Admin, Bulk]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       202:
 *         description: Mentor import job queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                   format: uuid
 */
router.post(
  "/mentors/import",
  upload.single("file"),
  cleanupUploadedFile,
  asyncHandler(BulkController.importMentors),
);

router.post(
  "/payments/process",
  validate(bulkPaymentsSchema),
  asyncHandler(BulkController.processPayments),
);

router.get(
  "/jobs/:jobId",
  validate(bulkJobIdParamSchema),
  asyncHandler(BulkController.getJobStatus),
);

export default router;
