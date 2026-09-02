import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth.middleware";
import { 
  adaptiveAuth, 
  requireHighSecurity, 
  handleChallengeResponse, 
  extractBiometrics,
  deviceAwareAuth,
  locationAwareAuth
} from "../middleware/adaptive-auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { AdaptiveAuthController } from "../controllers/adaptive-auth.controller";
import { 
  challengeResponseSchema, 
  riskAssessmentSchema,
  deviceTrustSchema,
  biometricVerificationSchema 
} from "../validators/schemas/adaptive-auth.schemas";

const router = Router();

// Rate limiting for adaptive auth endpoints
const adaptiveAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // More lenient for adaptive auth checks
  message: {
    success: false,
    error: "Too many adaptive authentication requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Challenge response endpoint (public with rate limiting)
router.post(
  "/challenge/respond",
  adaptiveAuthLimiter,
  validate(challengeResponseSchema),
  asyncHandler(handleChallengeResponse)
);

// Risk assessment endpoint (authenticated)
router.post(
  "/risk/assess",
  authenticate,
  adaptiveAuthLimiter,
  extractBiometrics,
  validate(riskAssessmentSchema),
  asyncHandler(AdaptiveAuthController.assessRisk)
);

// Biometric verification endpoints
router.post(
  "/biometric/verify",
  authenticate,
  adaptiveAuthLimiter,
  extractBiometrics,
  validate(biometricVerificationSchema),
  asyncHandler(AdaptiveAuthController.verifyBiometric)
);

router.post(
  "/biometric/train",
  authenticate,
  extractBiometrics,
  asyncHandler(AdaptiveAuthController.submitBiometricSample)
);

router.get(
  "/biometric/profile",
  authenticate,
  asyncHandler(AdaptiveAuthController.getBiometricProfile)
);

// Device management endpoints
router.get(
  "/devices",
  authenticate,
  asyncHandler(AdaptiveAuthController.getUserDevices)
);

router.post(
  "/devices/trust",
  authenticate,
  validate(deviceTrustSchema),
  asyncHandler(AdaptiveAuthController.trustDevice)
);

router.delete(
  "/devices/:deviceId/trust",
  authenticate,
  asyncHandler(AdaptiveAuthController.untrustDevice)
);

router.delete(
  "/devices/:deviceId",
  authenticate,
  asyncHandler(AdaptiveAuthController.removeDevice)
);

// Authentication session management
router.get(
  "/sessions/adaptive",
  authenticate,
  asyncHandler(AdaptiveAuthController.getAdaptiveSessions)
);

router.get(
  "/sessions/:sessionId/status",
  authenticate,
  asyncHandler(AdaptiveAuthController.getSessionStatus)
);

router.post(
  "/sessions/:sessionId/refresh-auth",
  authenticate,
  extractBiometrics,
  asyncHandler(AdaptiveAuthController.refreshAuthentication)
);

// Security monitoring endpoints
router.get(
  "/security/incidents",
  authenticate,
  asyncHandler(AdaptiveAuthController.getSecurityIncidents)
);

router.post(
  "/security/incidents/:incidentId/resolve",
  authenticate,
  requireHighSecurity({ actionType: 'security_incident_resolution' }),
  asyncHandler(AdaptiveAuthController.resolveSecurityIncident)
);

// Risk analytics (admin/high privilege users)
router.get(
  "/analytics/risk-trends",
  authenticate,
  requireHighSecurity({ actionType: 'view_risk_analytics', minStrength: 80 }),
  asyncHandler(AdaptiveAuthController.getRiskTrends)
);

router.get(
  "/analytics/authentication-patterns",
  authenticate,
  requireHighSecurity({ actionType: 'view_auth_analytics', minStrength: 80 }),
  asyncHandler(AdaptiveAuthController.getAuthenticationPatterns)
);

// Continuous monitoring endpoints
router.post(
  "/monitoring/start",
  authenticate,
  extractBiometrics,
  asyncHandler(AdaptiveAuthController.startContinuousMonitoring)
);

router.post(
  "/monitoring/heartbeat",
  authenticate,
  extractBiometrics,
  asyncHandler(AdaptiveAuthController.monitoringHeartbeat)
);

router.post(
  "/monitoring/stop",
  authenticate,
  asyncHandler(AdaptiveAuthController.stopContinuousMonitoring)
);

// Admin endpoints for managing adaptive authentication
router.get(
  "/admin/risk-assessments",
  authenticate,
  requireHighSecurity({ actionType: 'admin_risk_review', minStrength: 90 }),
  asyncHandler(AdaptiveAuthController.getAdminRiskAssessments)
);

router.post(
  "/admin/users/:userId/reset-risk",
  authenticate,
  requireHighSecurity({ actionType: 'admin_risk_reset', minStrength: 90 }),
  asyncHandler(AdaptiveAuthController.resetUserRisk)
);

router.post(
  "/admin/incidents/:incidentId/investigate",
  authenticate,
  requireHighSecurity({ actionType: 'admin_incident_investigation', minStrength: 90 }),
  asyncHandler(AdaptiveAuthController.investigateIncident)
);

// Configuration endpoints
router.get(
  "/config/policies",
  authenticate,
  asyncHandler(AdaptiveAuthController.getAuthPolicies)
);

router.post(
  "/config/policies",
  authenticate,
  requireHighSecurity({ actionType: 'update_auth_policies', minStrength: 95 }),
  asyncHandler(AdaptiveAuthController.updateAuthPolicies)
);

// Testing endpoint (for development/testing only)
if (process.env.NODE_ENV === 'development') {
  router.post(
    "/test/simulate-risk",
    authenticate,
    asyncHandler(AdaptiveAuthController.simulateRisk)
  );
}

export default router;