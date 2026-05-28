import { Router } from "express";
import { CertificationController } from "../controllers/certification.controller";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";

const router = Router();

// All certification routes require authentication
router.use(authenticate);

/**
 * Certification Types Routes
 */

// Get all certification types
// GET /api/v1/certifications/types
router.get(
  "/types",
  CertificationController.getCertificationTypes
);

/**
 * Certification Management Routes
 */

// Create certification request
// POST /api/v1/certifications
router.post(
  "/",
  authorize(["mentor"]),
  CertificationController.createCertification
);

// Get mentor certifications
// GET /api/v1/certifications/mentor/:mentorId
router.get(
  "/mentor/:mentorId",
  authorize(["mentor", "admin"]),
  CertificationController.getMentorCertifications
);

// Get certification summary
// GET /api/v1/certifications/mentor/:mentorId/summary
router.get(
  "/mentor/:mentorId/summary",
  CertificationController.getCertificationSummary
);

// Update certification (admin only)
// PUT /api/v1/certifications/:certificationId
router.put(
  "/:certificationId",
  authorize(["admin"]),
  CertificationController.updateCertification
);

// Get pending certifications (admin only)
// GET /api/v1/certifications/pending
router.get(
  "/pending",
  authorize(["admin"]),
  CertificationController.getPendingCertifications
);

/**
 * Skill Test Routes
 */

// Start skill test
// POST /api/v1/certifications/tests/:testId/start
router.post(
  "/tests/:testId/start",
  authorize(["mentor"]),
  CertificationController.startSkillTest
);

// Submit test answers
// POST /api/v1/certifications/tests/attempts/:attemptId/submit
router.post(
  "/tests/attempts/:attemptId/submit",
  authorize(["mentor"]),
  CertificationController.submitTestAnswers
);

/**
 * Background Check Routes
 */

// Initiate background check
// POST /api/v1/certifications/background-checks
router.post(
  "/background-checks",
  authorize(["mentor"]),
  CertificationController.initiateBackgroundCheck
);

// Get background check status
// GET /api/v1/certifications/background-checks/:checkId
router.get(
  "/background-checks/:checkId",
  authorize(["mentor", "admin"]),
  CertificationController.getBackgroundCheck
);

/**
 * Onboarding Routes
 */

// Get onboarding progress
// GET /api/v1/certifications/onboarding/:mentorId
router.get(
  "/onboarding/:mentorId",
  authorize(["mentor", "admin"]),
  CertificationController.getOnboardingProgress
);

// Complete onboarding step
// POST /api/v1/certifications/onboarding/:mentorId/steps/:stepId/complete
router.post(
  "/onboarding/:mentorId/steps/:stepId/complete",
  authorize(["mentor"]),
  CertificationController.completeOnboardingStep
);

export default router;
