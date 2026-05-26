jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));
jest.mock("bcryptjs");
jest.mock("jsonwebtoken");
jest.mock("crypto");
jest.mock("../../services/token.service");
jest.mock("../../services/sessionManager.service");

import { AuthService } from "../../services/auth.service";
import pool from "../../config/database";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { TokenService } from "../../services/token.service";

const mockPool = pool as unknown as { query: jest.Mock; connect: jest.Mock };
const mockBcrypt = bcrypt as unknown as {
  genSalt: jest.Mock;
  hash: jest.Mock;
  compare: jest.Mock;
};
const mockJwt = jwt as unknown as { sign: jest.Mock; verify: jest.Mock };
const mockCrypto = crypto as unknown as {
  randomBytes: jest.Mock;
  createHash: jest.Mock;
};
const mockTokenService = TokenService as jest.Mocked<typeof TokenService>;

describe("AuthService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("register", () => {
    it("should register a new user successfully", async () => {
      const input = {
        email: "test@example.com",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        role: "mentee" as const,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // Email check
        .mockResolvedValueOnce({ rows: [{ id: "user-123", role: "mentee", user_tier: "free" }] }); // Insert

      mockBcrypt.genSalt.mockResolvedValue("salt");
      mockBcrypt.hash.mockResolvedValue("hashedPassword");

      const mockTokens = { accessToken: "access", refreshToken: "refresh" };
      mockTokenService.issueTokens.mockResolvedValue(mockTokens);

      const result = await AuthService.register(input);

      expect(result).toEqual({
        ...mockTokens,
        userId: "user-123",
      });
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockBcrypt.genSalt).toHaveBeenCalledWith(10);
      expect(mockBcrypt.hash).toHaveBeenCalledWith("password123", "salt");
      expect(mockTokenService.issueTokens).toHaveBeenCalledWith(
        "user-123",
        "test@example.com",
        "mentee",
        "free"
      );
    });

    it("should throw error if email already exists", async () => {
      const input = {
        email: "existing@example.com",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        role: "mentee" as const,
      };

      mockPool.query.mockResolvedValueOnce({ rows: [{ id: "existing" }] });

      await expect(AuthService.register(input)).rejects.toThrow(
        "Email is already registered.",
      );
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it("should set default notification preferences", async () => {
      const input = {
        email: "test@example.com",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        role: "mentor" as const,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: "user-123", role: "mentor", user_tier: "free" }] });

      mockBcrypt.genSalt.mockResolvedValue("salt");
      mockBcrypt.hash.mockResolvedValue("hashedPassword");
      mockTokenService.issueTokens.mockResolvedValue({ accessToken: "access", refreshToken: "refresh" });

      await AuthService.register(input);

      const insertCall = mockPool.query.mock.calls[1];
      const notificationPrefs = JSON.parse(insertCall[1][5]);
      
      expect(notificationPrefs).toHaveProperty("booking_confirmed");
      expect(notificationPrefs.booking_confirmed).toEqual({ email: true, push: true, in_app: true });
      expect(notificationPrefs).toHaveProperty("payment_processed");
      expect(notificationPrefs).toHaveProperty("session_reminder");
    });
  });

  describe("login", () => {
    it("should login user successfully without MFA", async () => {
      const input = {
        email: "test@example.com",
        password: "password123",
      };

      mockPool.query.mockResolvedValue({
        rows: [{ 
          id: "user-123", 
          role: "mentee", 
          password_hash: "hashed",
          mfa_enabled: false,
          user_tier: "free"
        }],
      });
      mockBcrypt.compare.mockResolvedValue(true);

      const mockTokens = { accessToken: "access", refreshToken: "refresh" };
      mockTokenService.issueTokens.mockResolvedValue(mockTokens);

      const result = await AuthService.login(input, "127.0.0.1", "Mozilla/5.0");

      expect(result).toEqual({
        tokens: mockTokens,
        userId: "user-123",
        role: "mentee",
      });
      expect(mockBcrypt.compare).toHaveBeenCalledWith("password123", "hashed");
    });

    it("should return MFA required when MFA is enabled", async () => {
      const input = {
        email: "test@example.com",
        password: "password123",
      };

      mockPool.query.mockResolvedValue({
        rows: [{ 
          id: "user-123", 
          role: "mentee", 
          password_hash: "hashed",
          mfa_enabled: true,
          user_tier: "premium"
        }],
      });
      mockBcrypt.compare.mockResolvedValue(true);
      mockJwt.sign.mockReturnValue("mfa-token");

      const result = await AuthService.login(input);

      expect(result).toEqual({
        mfaRequired: true,
        mfaToken: "mfa-token",
        userId: "user-123",
      });
      expect(mockJwt.sign).toHaveBeenCalledWith(
        { sub: "user-123", mfaPending: true },
        expect.any(String),
        { expiresIn: "5m" }
      );
    });

    it("should throw error for invalid email", async () => {
      const input = {
        email: "nonexistent@example.com",
        password: "password123",
      };

      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(AuthService.login(input)).rejects.toThrow(
        "Invalid email or password.",
      );
    });

    it("should throw error for invalid password", async () => {
      const input = {
        email: "test@example.com",
        password: "wrongpassword",
      };

      mockPool.query.mockResolvedValue({
        rows: [{ 
          id: "user-123", 
          role: "mentee", 
          password_hash: "hashed",
          mfa_enabled: false,
          user_tier: "free"
        }],
      });
      mockBcrypt.compare.mockResolvedValue(false);

      await expect(AuthService.login(input)).rejects.toThrow(
        "Invalid email or password.",
      );
    });

    it("should handle login with IP address and user agent", async () => {
      const input = {
        email: "test@example.com",
        password: "password123",
      };

      mockPool.query.mockResolvedValue({
        rows: [{ 
          id: "user-123", 
          role: "mentee", 
          password_hash: "hashed",
          mfa_enabled: false,
          user_tier: "free"
        }],
      });
      mockBcrypt.compare.mockResolvedValue(true);
      mockTokenService.issueTokens.mockResolvedValue({ 
        accessToken: "access", 
        refreshToken: "refresh" 
      });

      await AuthService.login(input, "192.168.1.1", "Chrome/90.0");

      expect(mockTokenService.issueTokens).toHaveBeenCalledWith(
        "user-123",
        "test@example.com",
        "mentee",
        "free",
        "192.168.1.1:Chrome/90.0",
        {
          deviceName: "Chrome/90.0",
          ipAddress: "192.168.1.1",
        }
      );
    });
  });

  describe("refresh", () => {
    it("should refresh tokens successfully", async () => {
      const refreshToken = "valid-refresh-token";
      const fingerprint = "device-fingerprint";

      const mockTokens = {
        accessToken: "new-access",
        refreshToken: "new-refresh",
      };
      mockTokenService.rotateRefreshToken.mockResolvedValue(mockTokens);

      const result = await AuthService.refresh(refreshToken, fingerprint);

      expect(result).toEqual(mockTokens);
      expect(mockTokenService.rotateRefreshToken).toHaveBeenCalledWith(
        refreshToken,
        fingerprint
      );
    });

    it("should refresh tokens without fingerprint", async () => {
      const refreshToken = "valid-refresh-token";

      const mockTokens = {
        accessToken: "new-access",
        refreshToken: "new-refresh",
      };
      mockTokenService.rotateRefreshToken.mockResolvedValue(mockTokens);

      const result = await AuthService.refresh(refreshToken);

      expect(result).toEqual(mockTokens);
      expect(mockTokenService.rotateRefreshToken).toHaveBeenCalledWith(
        refreshToken,
        undefined
      );
    });
  });

  describe("logout", () => {
    it("should revoke specific refresh token when provided", async () => {
      const userId = "user-123";
      const refreshToken = "refresh-token";

      mockTokenService.revokeRefreshToken.mockResolvedValue(undefined);

      await AuthService.logout(userId, refreshToken);

      expect(mockTokenService.revokeRefreshToken).toHaveBeenCalledWith(refreshToken);
    });

    it("should revoke all user sessions when no token provided", async () => {
      const userId = "user-123";

      mockTokenService.revokeAllUserSessions.mockResolvedValue(undefined);

      await AuthService.logout(userId);

      expect(mockTokenService.revokeAllUserSessions).toHaveBeenCalledWith(userId);
      expect(mockTokenService.revokeRefreshToken).not.toHaveBeenCalled();
    });

    it("should handle session manager errors gracefully", async () => {
      const userId = "user-123";
      const refreshToken = "refresh-token";

      mockTokenService.revokeRefreshToken.mockResolvedValue(undefined);

      await expect(AuthService.logout(userId, refreshToken)).resolves.not.toThrow();
    });
  });

  describe("forgotPassword", () => {
    it("should generate reset token for existing user", async () => {
      const email = "test@example.com";

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: "user-123" }] })
        .mockResolvedValueOnce({});

      mockCrypto.randomBytes.mockReturnValue(Buffer.from("randombytes"));
      mockCrypto.createHash.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("hashed-token"),
      } as unknown as crypto.Hash);

      const result = await AuthService.forgotPassword(email);

      expect(result).toBe("72616e646f6d6279746573"); // hex of 'randombytes'
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("UPDATE users SET reset_token"),
        expect.arrayContaining(["hashed-token", expect.any(Date), "user-123"])
      );
    });

    it("should return empty string for non-existent user", async () => {
      const email = "nonexistent@example.com";

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await AuthService.forgotPassword(email);

      expect(result).toBe("");
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it("should not update database for non-existent user", async () => {
      const email = "nonexistent@example.com";

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await AuthService.forgotPassword(email);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      expect(mockPool.query).not.toHaveBeenCalledWith(
        expect.stringContaining("UPDATE users"),
        expect.any(Array)
      );
    });
  });

  describe("resetPassword", () => {
    it("should reset password successfully", async () => {
      const input = {
        token: "reset-token",
        newPassword: "newpassword123",
      };

      mockCrypto.createHash.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("hashed-token"),
      } as unknown as crypto.Hash);

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: "user-123" }] })
        .mockResolvedValueOnce({});

      mockBcrypt.genSalt.mockResolvedValue("salt");
      mockBcrypt.hash.mockResolvedValue("new-hashed-password");
      mockTokenService.revokeAllUserSessions.mockResolvedValue(undefined);

      const result = await AuthService.resetPassword(input);

      expect(result).toBe("user-123");
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockBcrypt.hash).toHaveBeenCalledWith("newpassword123", "salt");
      expect(mockTokenService.revokeAllUserSessions).toHaveBeenCalledWith("user-123");
    });

    it("should throw error for invalid reset token", async () => {
      const input = {
        token: "invalid-token",
        newPassword: "newpassword123",
      };

      mockCrypto.createHash.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("hashed-token"),
      } as unknown as crypto.Hash);

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(AuthService.resetPassword(input)).rejects.toThrow(
        "Invalid or expired reset token.",
      );
      expect(mockBcrypt.hash).not.toHaveBeenCalled();
    });

    it("should throw error for expired reset token", async () => {
      const input = {
        token: "expired-token",
        newPassword: "newpassword123",
      };

      mockCrypto.createHash.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("hashed-token"),
      } as unknown as crypto.Hash);

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(AuthService.resetPassword(input)).rejects.toThrow(
        "Invalid or expired reset token.",
      );
    });

    it("should clear reset token after successful password reset", async () => {
      const input = {
        token: "reset-token",
        newPassword: "newpassword123",
      };

      mockCrypto.createHash.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("hashed-token"),
      } as unknown as crypto.Hash);

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: "user-123" }] })
        .mockResolvedValueOnce({});

      mockBcrypt.genSalt.mockResolvedValue("salt");
      mockBcrypt.hash.mockResolvedValue("new-hashed-password");
      mockTokenService.revokeAllUserSessions.mockResolvedValue(undefined);

      await AuthService.resetPassword(input);

      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("reset_token = NULL"),
        expect.arrayContaining(["new-hashed-password", "user-123"])
      );
    });
  });
});
