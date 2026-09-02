import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { UsersService } from "../services/users.service";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../validators/auth.validator";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { ZodError } from "zod";
import {
  AuditLogService,
  extractIpAddress,
} from "../services/auditLog.service";
import { LoginAttemptsService } from "../services/loginAttempts.service";
import { WebAuthnService } from "../services/webauthn.service";
import { MfaDeviceModel } from "../models/mfa-device.model";

export const AuthController = {
  async register(req: Request, res: Response) {
    try {
      const validatedData = registerSchema.parse(req).body;
      const result = await AuthService.register(validatedData);

      await AuditLogService.log({
        userId: result.userId || null,
        action: "USER_REGISTERED",
        resourceType: "auth",
        resourceId: result.userId || null,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers["user-agent"] || null,
        metadata: { email: validatedData.email, role: validatedData.role },
      });

      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Validation failed",
            details: error.issues,
          });
      }
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  async login(req: Request, res: Response) {
    const ipAddress = extractIpAddress(req);
    const userAgent = req.headers["user-agent"] || null;

    try {
      const validatedData = loginSchema.parse(req).body;
      const { email } = validatedData;

      // ── Check lockout status before attempting auth ──
      const lockStatus = await LoginAttemptsService.getStatus(email);

      if (lockStatus.locked) {
        await AuditLogService.log({
          userId: null,
          action: "LOGIN_BLOCKED_LOCKOUT",
          resourceType: "auth",
          ipAddress,
          userAgent,
          metadata: {
            email,
            permanent: lockStatus.permanent,
            attempts: lockStatus.attempts,
          },
        });

        if (lockStatus.permanent) {
          return res.status(429).json({
            success: false,
            error:
              "Account permanently locked due to too many failed attempts. Contact support.",
            captcha_required: true,
          });
        }

        res.setHeader("Retry-After", String(lockStatus.retryAfter ?? 900));
        return res.status(429).json({
          success: false,
          error: "Account temporarily locked. Too many failed login attempts.",
          retry_after: lockStatus.retryAfter,
          captcha_required: true,
        });
      }

      // ── Attempt login ──
      const result = await AuthService.login(
        validatedData,
        ipAddress,
        userAgent,
      );

      if (result.mfaRequired) {
        return res.status(200).json({
          success: true,
          mfa_required: true,
          mfa_token: result.mfaToken,
        });
      }

      // Success — reset counter
      await LoginAttemptsService.resetAttempts(email);

      await AuditLogService.log({
        userId: result.userId,
        action: "LOGIN_SUCCESS",
        resourceType: "auth",
        resourceId: result.userId,
        ipAddress,
        userAgent,
        metadata: { email },
      });

      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      // Parse email from body for failure tracking (safe — already validated above if we got here)
      const parsed = loginSchema.safeParse(req);
      const email = parsed.success ? parsed.data.body.email : null;

      if (email) {
        // Record failure and get updated status
        const lockStatus = await LoginAttemptsService.recordFailure(
          email,
          ipAddress,
          email,
        );

        await AuditLogService.log({
          userId: null,
          action: "LOGIN_FAILED",
          resourceType: "auth",
          ipAddress,
          userAgent,
          metadata: {
            email,
            reason: error.message,
            attempts: lockStatus.attempts,
            locked: lockStatus.locked,
          },
        });

        // If this failure just triggered a lockout, respond with 429
        if (lockStatus.locked) {
          if (lockStatus.permanent) {
            return res.status(429).json({
              success: false,
              error:
                "Account permanently locked due to too many failed attempts. Contact support.",
              captcha_required: true,
            });
          }

          res.setHeader("Retry-After", String(lockStatus.retryAfter ?? 900));
          return res.status(429).json({
            success: false,
            error:
              "Account temporarily locked. Too many failed login attempts.",
            retry_after: lockStatus.retryAfter,
            captcha_required: true,
          });
        }

        // Not yet locked — return normal auth error with captcha hint
        if (error instanceof ZodError) {
          return res
            .status(400)
            .json({
              success: false,
              error: "Validation failed",
              details: error.issues,
            });
        }

        return res.status(401).json({
          success: false,
          error: "Invalid email or password.",
          captcha_required: lockStatus.captchaRequired,
          attempts_remaining: Math.max(0, 5 - lockStatus.attempts),
        });
      }

      if (error instanceof ZodError) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Validation failed",
            details: error.issues,
          });
      }
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  async logout(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (userId) {
        await AuthService.logout(userId);

        await AuditLogService.log({
          userId,
          action: "LOGOUT",
          resourceType: "auth",
          resourceId: userId,
          ipAddress: extractIpAddress(req),
          userAgent: req.headers["user-agent"] || null,
        });
      }
      return res
        .status(200)
        .json({ success: true, message: "Logged out successfully." });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async forgotPassword(req: Request, res: Response) {
    try {
      const validatedData = forgotPasswordSchema.parse(req).body;
      await AuthService.forgotPassword(validatedData.email);
      return res.status(200).json({
        success: true,
        message: "If the email exists, a reset link has been generated.",
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Validation failed",
            details: error.issues,
          });
      }
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  async resetPassword(req: Request, res: Response) {
    try {
      const validatedData = resetPasswordSchema.parse(req).body;
      const userId = await AuthService.resetPassword(validatedData);

      if (userId) {
        await AuditLogService.log({
          userId,
          action: "PASSWORD_CHANGED",
          resourceType: "auth",
          resourceId: userId,
          ipAddress: extractIpAddress(req),
          userAgent: req.headers["user-agent"] || null,
          metadata: { method: "reset_token" },
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Password reset successfully. You can now login with your new password.",
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Validation failed",
            details: error.issues,
          });
      }
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  async getMe(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const user = await UsersService.findPublicById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "User not found." });
      }

      return res.status(200).json({ success: true, data: user });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  // ── WebAuthn / Passkey endpoints ───────────────────────────────────────────

  /**
   * POST /auth/passkey/register/begin
   * Generate registration options (challenge) for a new passkey.
   * Requires the user to be authenticated.
   */
  async passkeyRegisterBegin(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const { deviceName, authenticatorAttachment, userVerification } = req.body;
      const user = await UsersService.findPublicById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: "User not found" });
      }

      const options = await WebAuthnService.generateRegistrationOptions({
        userId,
        userName: user.email || userId,
        userDisplayName: user.name || user.email || userId,
        authenticatorAttachment,
        userVerification,
      });

      return res.status(200).json({ success: true, data: options });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /auth/passkey/register/complete
   * Verify and store the new passkey credential.
   */
  async passkeyRegisterComplete(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const { credential, deviceName } = req.body;
      if (!credential) {
        return res.status(400).json({ success: false, error: "credential is required" });
      }

      const result = await WebAuthnService.verifyRegistration({
        userId,
        credential,
        deviceName,
      });

      if ("error" in result) {
        return res.status(400).json({ success: false, error: result.error });
      }

      await AuditLogService.log({
        userId,
        action: "PASSKEY_REGISTERED",
        resourceType: "auth",
        resourceId: result.device.id,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers["user-agent"] || null,
        metadata: { deviceName: result.device.name },
      });

      return res.status(201).json({ success: true, data: { deviceId: result.device.id, deviceName: result.device.name } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /auth/passkey/auth/begin
   * Generate authentication options (challenge) for passkey login.
   * Public endpoint — userId from request body.
   */
  async passkeyAuthBegin(req: Request, res: Response) {
    try {
      const { userId, userVerification } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, error: "userId is required" });
      }

      const options = await WebAuthnService.generateAuthenticationOptions({
        userId,
        userVerification,
      });

      return res.status(200).json({ success: true, data: options });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /auth/passkey/auth/complete
   * Verify the assertion response and return a session token on success.
   * Fallback: if no passkeys registered, client should fall back to TOTP (/auth/mfa/validate).
   */
  async passkeyAuthComplete(req: Request, res: Response) {
    try {
      const { userId, credential } = req.body;
      if (!userId || !credential) {
        return res.status(400).json({ success: false, error: "userId and credential are required" });
      }

      const result = await WebAuthnService.verifyAuthentication({ userId, credential });

      if (!result.success) {
        await AuditLogService.log({
          userId,
          action: "PASSKEY_AUTH_FAILED",
          resourceType: "auth",
          ipAddress: extractIpAddress(req as any),
          userAgent: req.headers["user-agent"] || null,
          metadata: { error: result.error },
        });
        return res.status(401).json({ success: false, error: result.error || "Authentication failed" });
      }

      // Load user to get email + role for token generation
      const user = await UsersService.findPublicById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: "User not found" });
      }

      const { TokenService } = await import("../services/token.service");
      const tokens = await TokenService.issueTokens(
        userId,
        user.email,
        user.role || "user",
        user.user_tier || "free",
        undefined,
        { ipAddress: extractIpAddress(req as any) },
        true, // mfaVerified — passkey counts as strong auth
      );

      await AuditLogService.log({
        userId,
        action: "PASSKEY_AUTH_SUCCESS",
        resourceType: "auth",
        resourceId: userId,
        ipAddress: extractIpAddress(req as any),
        userAgent: req.headers["user-agent"] || null,
        metadata: { deviceId: result.device?.id },
      });

      return res.status(200).json({ success: true, data: tokens });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /auth/passkey/devices
   * List all registered passkey devices for the authenticated user.
   */
  async listPasskeyDevices(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const devices = await MfaDeviceModel.listByUserAndType(userId, "webauthn");
      const safeDevices = devices.map((d) => ({
        id: d.id,
        name: d.name,
        aaguid: d.aaguid,
        createdAt: d.created_at,
        lastUsedAt: d.last_used_at,
      }));

      return res.status(200).json({ success: true, data: safeDevices });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * DELETE /auth/passkey/devices/:id
   * Remove a registered passkey device.
   */
  async removePasskeyDevice(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const removed = await MfaDeviceModel.remove(req.params.id, userId);
      if (!removed) {
        return res.status(404).json({ success: false, error: "Device not found" });
      }

      await AuditLogService.log({
        userId,
        action: "PASSKEY_DEVICE_REMOVED",
        resourceType: "auth",
        resourceId: req.params.id,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers["user-agent"] || null,
      });

      return res.status(200).json({ success: true, message: "Passkey device removed" });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },
};
