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

import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import pool from "../../config/database";
import { AuthService } from "../../services/auth.service";

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

function createHashMock(digestHex: string): crypto.Hash {
  const update = jest.fn().mockReturnThis();
  const digest = jest.fn().mockReturnValue(digestHex);
  return { update, digest } as unknown as crypto.Hash;
}

describe("AuthService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("register", () => {
    it("registra un usuario y devuelve tokens", async () => {
      const input = {
        email: "test@example.com",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        role: "mentee" as const,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: "user-123", role: "mentee" }] });

      mockBcrypt.genSalt.mockResolvedValue("salt");
      mockBcrypt.hash.mockResolvedValue("hashedPassword");

      const mockTokens = { accessToken: "access", refreshToken: "refresh" };
      jest.spyOn(AuthService, "generateTokens").mockResolvedValue(mockTokens);

      const result = await AuthService.register(input);

      expect(result).toEqual({ ...mockTokens, userId: "user-123" });
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it("rechaza email duplicado", async () => {
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
    });

    it("propaga fallo de base de datos al comprobar email", async () => {
      const input = {
        email: "test@example.com",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        role: "mentee" as const,
      };

      mockPool.query.mockRejectedValueOnce(new Error("connection refused"));

      await expect(AuthService.register(input)).rejects.toThrow(
        "connection refused",
      );
    });
  });

  describe("login", () => {
    it("inicia sesión con credenciales válidas", async () => {
      const input = { email: "test@example.com", password: "password123" };

      mockPool.query.mockResolvedValue({
        rows: [{ id: "user-123", role: "mentee", password_hash: "hashed" }],
      });
      mockBcrypt.compare.mockResolvedValue(true);

      const mockTokens = { accessToken: "access", refreshToken: "refresh" };
      jest.spyOn(AuthService, "generateTokens").mockResolvedValue(mockTokens);

      const result = await AuthService.login(input);

      expect(result).toEqual({
        tokens: mockTokens,
        userId: "user-123",
        role: "mentee",
      });
    });

    it("rechaza email inexistente", async () => {
      const input = { email: "no@example.com", password: "password123" };
      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(AuthService.login(input)).rejects.toThrow(
        "Invalid email or password.",
      );
    });

    it("rechaza contraseña incorrecta", async () => {
      const input = { email: "test@example.com", password: "wrong" };
      mockPool.query.mockResolvedValue({
        rows: [{ id: "user-123", role: "mentee", password_hash: "hashed" }],
      });
      mockBcrypt.compare.mockResolvedValue(false);

      await expect(AuthService.login(input)).rejects.toThrow(
        "Invalid email or password.",
      );
    });
  });

  describe("refresh", () => {
    it("renueva tokens cuando el refresh coincide con la base de datos", async () => {
      const refreshToken = "valid-refresh-token";

      mockJwt.verify.mockReturnValue({ sub: "user-123", role: "mentee" });
      mockPool.query.mockResolvedValue({
        rows: [{ refresh_token: refreshToken, role: "mentee" }],
      });

      const mockTokens = {
        accessToken: "new-access",
        refreshToken: "new-refresh",
      };
      jest.spyOn(AuthService, "generateTokens").mockResolvedValue(mockTokens);

      const result = await AuthService.refresh(refreshToken);

      expect(result).toEqual(mockTokens);
    });

    it("rechaza token JWT inválido", async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await expect(AuthService.refresh("bad")).rejects.toThrow(
        "Invalid or expired refresh token.",
      );
    });

    it("rechaza reutilización de refresh (no coincide con DB)", async () => {
      mockJwt.verify.mockReturnValue({ sub: "user-123", role: "mentee" });
      mockPool.query.mockResolvedValue({
        rows: [{ refresh_token: "otro-token", role: "mentee" }],
      });

      await expect(AuthService.refresh("token-a")).rejects.toThrow(
        "Invalid or expired refresh token.",
      );
    });

    it("rechaza usuario inactivo o inexistente en refresh", async () => {
      mockJwt.verify.mockReturnValue({ sub: "user-123", role: "mentee" });
      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(AuthService.refresh("token-a")).rejects.toThrow(
        "Invalid or expired refresh token.",
      );
    });
  });

  describe("logout", () => {
    it("limpia el refresh token", async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: "UPDATE",
        oid: 0,
        fields: [],
      });

      await AuthService.logout("user-123");

      expect(mockPool.query).toHaveBeenCalledWith(
        "UPDATE users SET refresh_token = NULL WHERE id = $1",
        ["user-123"],
      );
    });
  });

  describe("forgotPassword", () => {
    it("genera token de reset para usuario existente", async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: "user-123" }] })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 1,
          command: "UPDATE",
          oid: 0,
          fields: [],
        });

      mockCrypto.randomBytes.mockReturnValue(Buffer.from("randombytes"));
      mockCrypto.createHash.mockReturnValue(createHashMock("hashed-token"));

      const result = await AuthService.forgotPassword("test@example.com");

      expect(result).toBe("72616e646f6d6279746573");
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it("no revela existencia de usuario", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await AuthService.forgotPassword("ghost@example.com");

      expect(result).toBe("");
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe("resetPassword", () => {
    it("actualiza contraseña con token válido", async () => {
      const input = { token: "reset-token", newPassword: "newpassword123" };

      mockCrypto.createHash.mockReturnValue(createHashMock("hashed-token"));

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: "user-123" }] })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 1,
          command: "UPDATE",
          oid: 0,
          fields: [],
        });

      mockBcrypt.genSalt.mockResolvedValue("salt");
      mockBcrypt.hash.mockResolvedValue("new-hashed-password");

      const result = await AuthService.resetPassword(input);

      expect(result).toBe("user-123");
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it("rechaza token inválido o expirado", async () => {
      const input = { token: "invalid-token", newPassword: "newpassword123" };

      mockCrypto.createHash.mockReturnValue(createHashMock("hashed-token"));
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(AuthService.resetPassword(input)).rejects.toThrow(
        "Invalid or expired reset token.",
      );
    });
  });

  describe("generateTokens", () => {
    it("firma tokens y persiste refresh en base de datos", async () => {
      mockJwt.sign
        .mockReturnValueOnce("access-token")
        .mockReturnValueOnce("refresh-token");
      mockPool.query.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: "UPDATE",
        oid: 0,
        fields: [],
      });

      const result = await AuthService.generateTokens("user-123", "mentee");

      expect(result).toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
      });
      expect(mockJwt.sign).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        "UPDATE users SET refresh_token = $1 WHERE id = $2",
        ["refresh-token", "user-123"],
      );
    });
  });
});
