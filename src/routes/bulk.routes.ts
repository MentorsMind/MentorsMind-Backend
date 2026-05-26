import { Router } from "express";
import multer from "multer";
import { BulkController } from "../controllers/bulk.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { bulkPaymentsSchema } from "../validators/schemas/bulk.schemas";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(authenticate, requireAdmin);

router.post(
  "/users/import",
  upload.single("file"),
  asyncHandler(BulkController.importUsers),
);

router.post(
  "/payments/process",
  validate(bulkPaymentsSchema),
  asyncHandler(BulkController.processPayments),
);

router.get("/jobs/:jobId", asyncHandler(BulkController.getJobStatus));

export default router;
