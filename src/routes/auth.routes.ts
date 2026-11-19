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
import { noCacheMiddleware } from "../middleware/no-cache.middleware";
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

// Disable caching for all authentication endpoints
router.use(noCacheMiddleware);

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

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, firstName, lastName]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *               role:
 *                 type: string
 *                 enum: [mentee, mentor]
 *                 default: mentee
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 userId:
 *                   type: string
 *                   format: uuid
 *       409:
 *         description: Email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Public routes (rate limited)
router.post("/register", authLimiter, validate(registerSchema), AuthController.register);
/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Authenticate with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 expiresIn:
 *                   type: integer
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// loginLockoutCheck runs before the handler to short-circuit locked accounts early
router.post(
  "/login",
  authLimiter,
  validate(loginSchema),
  asyncHandler(loginLockoutCheck),
  AuthController.login,
);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Rotate tokens — exchange a valid refresh token for a new access/refresh token pair
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: The refresh token issued at login or a previous refresh
 *     responses:
 *       200:
 *         description: New token pair issued; previous refresh token is invalidated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 expiresIn:
 *                   type: integer
 *                   description: Access token TTL in seconds
 *       401:
 *         description: Refresh token expired, revoked, or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/refresh",
  authLimiter,
  validate(refreshTokenSchema),
  asyncHandler(handleTokenRefresh),
);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Request a password reset link
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Reset email sent (always 200 to prevent user enumeration)
 */
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

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Invalidate the current session and refresh token
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully; refresh token revoked
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
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
