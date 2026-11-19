/**
 * auth-register-conflict.unit.test.ts
 *
 * Tests for concurrent registration race condition handling.
 * Verifies that when two simultaneous registrations arrive with the same email,
 * one succeeds and the other receives a 409 CONFLICT response with a user-friendly message.
 */

import { AuthService } from "../auth.service";
import { ErrorCode } from "../../errors/error-codes";
import { createError } from "../../middleware/errorHandler";
import pool from "../../config/database";

// Mock the pool and bcrypt
jest.mock("../../config/database");
jest.mock("bcryptjs");
jest.mock("../token.service", () => ({
  TokenService: {
    issueTokens: jest.fn().mockResolvedValue({
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
    }),
  },
}));

import bcrypt from "bcryptjs";

describe("AuthService.register - Concurrent Registration Conflict", () => {
  const mockInput = {
    email: "test@example.com",
    password: "SecurePassword123!",
    firstName: "Test",
    lastName: "User",
    role: "student",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("UNIQUE_VIOLATION on email constraint", () => {
    it("should convert PostgreSQL UNIQUE_VIOLATION (23505) on email to CONFLICT error", async () => {
      // Mock bcrypt
      (bcrypt.genSalt as jest.Mock).mockResolvedValue("$2a$10$mockSalt");
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$10$mockHash");

      // First query (uniqueness check) returns no rows — passes
      // Insert query throws UNIQUE_VIOLATION error
      const uniqueViolationError: any = new Error(
        "duplicate key value violates unique constraint"
      );
      uniqueViolationError.code = "23505";
      uniqueViolationError.constraint = "users_email_unique";

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] }) // Uniqueness check passes
        .mockRejectedValueOnce(uniqueViolationError); // Insert fails with 23505

      // Act & Assert
      await expect(AuthService.register(mockInput)).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        statusCode: 409,
        details: expect.objectContaining({
          message: "An account with this email already exists",
        }),
      });
    });

    it("should return 409 Conflict status code for concurrent registrations", async () => {
      (bcrypt.genSalt as jest.Mock).mockResolvedValue("$2a$10$mockSalt");
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$10$mockHash");

      const uniqueViolationError: any = new Error(
        "duplicate key value violates unique constraint"
      );
      uniqueViolationError.code = "23505";
      uniqueViolationError.constraint = "users_email_unique";

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(uniqueViolationError);

      try {
        await AuthService.register(mockInput);
        fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe(ErrorCode.CONFLICT);
      }
    });

    it("should provide user-friendly message instead of raw database error", async () => {
      (bcrypt.genSalt as jest.Mock).mockResolvedValue("$2a$10$mockSalt");
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$10$mockHash");

      const uniqueViolationError: any = new Error(
        "duplicate key value violates unique constraint \"users_email_unique\""
      );
      uniqueViolationError.code = "23505";
      uniqueViolationError.constraint = "users_email_unique";

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(uniqueViolationError);

      try {
        await AuthService.register(mockInput);
        fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).not.toContain("duplicate key value");
        expect(err.message).not.toContain("constraint");
        expect(err.details?.message).toBe(
          "An account with this email already exists"
        );
      }
    });
  });

  describe("Other database errors", () => {
    it("should re-throw errors that are not UNIQUE_VIOLATION on email", async () => {
      (bcrypt.genSalt as jest.Mock).mockResolvedValue("$2a$10$mockSalt");
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$10$mockHash");

      // Foreign key violation (different constraint)
      const fkError: any = new Error("foreign key constraint violation");
      fkError.code = "23503";
      fkError.constraint = "users_role_fk";

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(fkError);

      await expect(AuthService.register(mockInput)).rejects.toEqual(fkError);
    });

    it("should re-throw UNIQUE_VIOLATION errors not related to email", async () => {
      (bcrypt.genSalt as jest.Mock).mockResolvedValue("$2a$10$mockSalt");
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$10$mockHash");

      // UNIQUE_VIOLATION but on a different constraint (not email)
      const uniqueViolationError: any = new Error(
        "duplicate key value violates unique constraint"
      );
      uniqueViolationError.code = "23505";
      uniqueViolationError.constraint = "users_wallet_id_unique"; // Different constraint

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(uniqueViolationError);

      await expect(AuthService.register(mockInput)).rejects.toEqual(
        uniqueViolationError
      );
    });

    it("should not convert UNIQUE_VIOLATION without email constraint", async () => {
      (bcrypt.genSalt as jest.Mock).mockResolvedValue("$2a$10$mockSalt");
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$10$mockHash");

      const uniqueViolationError: any = new Error(
        "duplicate key value violates unique constraint"
      );
      uniqueViolationError.code = "23505";
      uniqueViolationError.constraint = undefined; // No constraint info

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(uniqueViolationError);

      await expect(AuthService.register(mockInput)).rejects.toEqual(
        uniqueViolationError
      );
    });
  });

  describe("Successful registration", () => {
    it("should register user successfully when no conflicts occur", async () => {
      (bcrypt.genSalt as jest.Mock).mockResolvedValue("$2a$10$mockSalt");
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$10$mockHash");

      const mockUser = {
        id: "user-123",
        role: "student",
        user_tier: "free",
      };

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] }) // Uniqueness check
        .mockResolvedValueOnce({ rows: [mockUser] }); // Insert succeeds

      const result = await AuthService.register(mockInput);

      expect(result).toMatchObject({
        userId: "user-123",
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
      });
    });
  });
});
