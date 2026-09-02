import { MfaOtpController } from "../controllers/mfa-otp.controller";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AuthController } from "../controllers/auth.controller";
import { SessionsController } from "../controllers/sessions.controller";
import { MfaController } from "../controllers/mfa.controller";
import { OAuthController } from "../controllers/oauth.controller";
import { JwksController } from "../controllers/jwks.controller";
import { authenticate } from "../middleware/auth.middleware";
import { handleTokenRefresh } from "../middleware/token-refresh.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { loginLockoutCheck } from "../middleware/rate-limit.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  mfaVerifySetupSchema,
  mfaDisableSchema,
  mfaValidateSchema,
  mfaBackupSchema,
  mfaOtpSendSchema,
  mfaOtpSetupSchema,
  mfaOtpValidateSchema,
  listAuthSessionsSchema,
  revokeSessionParamSchema,
  oauthProviderParamSchema,
} from "../validators/schemas/auth.schemas";

const router = Router();

// Apply stricter rate limiting for auth endpoints to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs for auth routes
  message: {
    success: false,
    error: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes (rate limited)
router.post("/register", authLimiter, validate(registerSchema), AuthController.register);
// loginLockoutCheck runs before the handler to short-circuit locked accounts early
router.post(
  "/login",
  authLimiter,
  validate(loginSchema),
  asyncHandler(loginLockoutCheck),
  AuthController.login,
);
router.post(
  "/refresh",
  authLimiter,
  validate(refreshTokenSchema),
  asyncHandler(handleTokenRefresh),
);
router.post(
  "/forgot-password",
  authLimiter,
  validate(forgotPasswordSchema),
  AuthController.forgotPassword,
);
router.post(
  "/reset-password",
  authLimiter,
  validate(resetPasswordSchema),
  AuthController.resetPassword,
);

// MFA Public routes
router.post(
  "/mfa/validate",
  authLimiter,
  validate(mfaValidateSchema),
  asyncHandler(MfaController.validate),
);
router.post(
  "/mfa/backup",
  authLimiter,
  validate(mfaBackupSchema),
  asyncHandler(MfaController.backup),
);

// Protected routes (no strict rate limiting required beyond global)
router.post("/logout", authenticate, AuthController.logout);
router.get("/me", authenticate, AuthController.getMe);

// MFA Protected routes
router.post("/mfa/setup", authenticate, asyncHandler(MfaController.setup));
router.post(
  "/mfa/verify-setup",
  authenticate,
  validate(mfaVerifySetupSchema),
  asyncHandler(MfaController.verifySetup),
);
router.post(
  "/mfa/disable",
  authenticate,
  validate(mfaDisableSchema),
  asyncHandler(MfaController.disable),
);

// MFA OTP routes (SMS/email)
router.post(
  "/mfa/otp/send",
  authenticate,
  validate(mfaOtpSendSchema),
  asyncHandler(MfaOtpController.sendOtp),
);
router.post(
  "/mfa/otp/setup",
  authenticate,
  validate(mfaOtpSetupSchema),
  asyncHandler(MfaOtpController.setupOtp),
);
router.post(
  "/mfa/otp/validate",
  authLimiter,
  validate(mfaOtpValidateSchema),
  asyncHandler(MfaOtpController.validateOtp),
);

// Session management routes
router.get(
  "/sessions",
  authenticate,
  validate(listAuthSessionsSchema),
  asyncHandler(SessionsController.listSessions),
);
router.delete(
  "/sessions",
  authenticate,
  asyncHandler(SessionsController.revokeAllSessions),
);
router.delete(
  "/sessions/:id",
  authenticate,
  validate(revokeSessionParamSchema),
  asyncHandler(SessionsController.revokeSession),
);

// OAuth routes
router.get("/google", asyncHandler(OAuthController.googleAuth));
router.get("/google/callback", asyncHandler(OAuthController.googleCallback));
router.get("/github", asyncHandler(OAuthController.githubAuth));
router.get("/github/callback", asyncHandler(OAuthController.githubCallback));
router.get("/linkedin", asyncHandler(OAuthController.linkedinAuth));
router.get("/linkedin/callback", asyncHandler(OAuthController.linkedinCallback));
router.get("/microsoft", asyncHandler(OAuthController.microsoftAuth));
router.get("/microsoft/callback", asyncHandler(OAuthController.microsoftCallback));
router.get(
  "/oauth/providers",
  authenticate,
  asyncHandler(OAuthController.getLinkedProviders),
);
router.delete(
  "/oauth/:provider",
  authenticate,
  validate(oauthProviderParamSchema),
  asyncHandler(OAuthController.unlinkProvider),
);

// JWKS endpoint
router.get("/jwks", asyncHandler(JwksController.getJwks));

// ── WebAuthn / Passkey routes ─────────────────────────────────────────────

// Registration flow (authenticated user adding a new passkey)
router.post(
  "/passkey/register/begin",
  authenticate,
  asyncHandler(AuthController.passkeyRegisterBegin),
);
router.post(
  "/passkey/register/complete",
  authenticate,
  asyncHandler(AuthController.passkeyRegisterComplete),
);

// Authentication flow (public — rate limited to prevent abuse)
router.post(
  "/passkey/auth/begin",
  authLimiter,
  asyncHandler(AuthController.passkeyAuthBegin),
);
router.post(
  "/passkey/auth/complete",
  authLimiter,
  asyncHandler(AuthController.passkeyAuthComplete),
);

// Device management (authenticated)
router.get(
  "/passkey/devices",
  authenticate,
  asyncHandler(AuthController.listPasskeyDevices),
);
router.delete(
  "/passkey/devices/:id",
  authenticate,
  asyncHandler(AuthController.removePasskeyDevice),
);

export default router;
