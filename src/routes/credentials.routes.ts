import { Router } from "express";
import { CredentialsController } from "../controllers/credentials.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole as authorize } from "../middleware/rbac.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

router.get(
  "/:credentialId/status",
  asyncHandler(CredentialsController.getCredentialStatus),
);

router.get(
  "/:credentialId/verify",
  asyncHandler(CredentialsController.verifyCredential),
);

router.use(authenticate);

router.get(
  "/subject/:subjectDid",
  authorize("admin"),
  asyncHandler(CredentialsController.getCredentialsBySubject),
);

router.post(
  "/",
  authorize("admin"),
  asyncHandler(CredentialsController.issueCredential),
);

router.post(
  "/revoke-batch",
  authorize("admin"),
  asyncHandler(CredentialsController.revokeCredentials),
);

router.post(
  "/:credentialId/revoke",
  authorize("admin"),
  asyncHandler(CredentialsController.revokeCredential),
);

export default router;
