import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { MfaOtpService } from "../services/mfa-otp.service";
import { TokenService } from "../services/token.service";
import { SessionManagerService } from "../services/sessionManager.service";
import {
  AuditLogService,
  extractIpAddress,
} from "../services/auditLog.service";
import emailService from "../services/email.service";
import pool from "../config/database";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const MfaOtpController = {
  /**
   * POST /auth/mfa/otp/send
   * Authenticated — send OTP via SMS or email to set up or use MFA.
   */
  async sendOtp(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { method } = req.body as { method: "sms" | "email" };

    if (!["sms", "email"].includes(method)) {
      res
        .status(400)
        .json({ success: false, error: "method must be sms or email" });
      return;
    }

    const { rows } = await pool.query(
      `SELECT email, mfa_phone FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows.length) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    const code = await MfaOtpService.generateOtp(userId, method);

    if (method === "email") {
      await emailService.sendEmail({
        to: [rows[0].email],
        subject: "Your MentorMinds verification code",
        textContent: `Your verification code is: ${code}\nIt expires in 10 minutes.`,
      });
    }
    // SMS: in production, integrate Twilio/SNS here using rows[0].mfa_phone

    res.json({ success: true, message: `OTP sent via ${method}` });
  },

  /**
   * POST /auth/mfa/otp/setup
   * Authenticated — verify OTP and enable SMS/email MFA.
   */
  async setupOtp(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { method, code, phone } = req.body as {
      method: "sms" | "email";
      code: string;
      phone?: string;
    };

    const valid = await MfaOtpService.verifyOtp(userId, method, code);
    if (!valid) {
      res.status(401).json({ success: false, error: "Invalid or expired OTP" });
      return;
    }

    const backupCodes = await MfaOtpService.enableOtpMfaWithCodes(
      userId,
      method,
      phone,
    );

    await AuditLogService.log({
      userId,
      action: "MFA_ENABLED",
      resourceType: "auth",
      resourceId: userId,
      ipAddress: extractIpAddress(req),
      userAgent: req.headers["user-agent"] || null,
    });

    res.json({ success: true, message: "MFA enabled", data: { backupCodes } });
  },

  /**
   * POST /auth/mfa/otp/validate
   * Public — validate OTP during login (after mfaToken issued).
   */
  async validateOtp(req: Request, res: Response): Promise<void> {
    const { mfaToken, code } = req.body as { mfaToken: string; code: string };

    if (!mfaToken || !code) {
      res
        .status(400)
        .json({ success: false, error: "mfaToken and code are required" });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(mfaToken, env.JWT_SECRET);
    } catch {
      res.status(401).json({ success: false, error: "MFA session expired" });
      return;
    }

    if (!decoded.mfaPending) {
      res.status(401).json({ success: false, error: "Invalid MFA session" });
      return;
    }

    const userId = decoded.sub as string;
    const { rows } = await pool.query(
      `SELECT mfa_method, role, email, user_tier FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows.length) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    const { mfa_method, role, email, user_tier } = rows[0];
    const valid = await MfaOtpService.verifyOtp(userId, mfa_method, code);
    if (!valid) {
      res.status(401).json({ success: false, error: "Invalid or expired OTP" });
      return;
    }

    const tokens = await TokenService.issueTokens(
      userId,
      email,
      role,
      user_tier,
      undefined,
      undefined,
      true,
    );
    await SessionManagerService.createSession({
      userId,
      refreshToken: tokens.refreshToken,
      ipAddress: (req as any).ip,
      userAgent: req.headers["user-agent"] || null,
      userEmail: email,
    });

    res.json({ success: true, data: { tokens, userId, role } });
  },
};
