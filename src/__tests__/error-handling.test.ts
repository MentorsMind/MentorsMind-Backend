/**
 * Error Handling System Tests
 * Verifies structured error responses with machine-readable codes
 */

import { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  AuthenticationError,
  BusinessLogicError,
  ExternalServiceError,
} from "../types/error.types";
import {
  BOOKING_CODES,
  NOT_FOUND_CODES,
  PAYMENT_CODES,
  AUTH_CODES,
  BUSINESS_CODES,
  SERVICE_CODES,
  VALIDATION_CODES,
  ERROR_CODE_TO_STATUS,
} from "../constants/error-codes";

describe("Error Handling System", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let setHeaderMock: jest.Mock;

  beforeEach(() => {
    // Setup mock response
    jsonMock = jest.fn();
    statusMock = jest.fn(() => ({ json: jsonMock }));
    setHeaderMock = jest.fn();

    mockRes = {
      status: statusMock,
      json: jsonMock,
      setHeader: setHeaderMock,
      locals: {},
    };

    // Setup mock request
    mockReq = {
      method: "POST",
      path: "/api/v1/bookings",
      headers: {},
      ip: "192.168.1.1",
    };

    mockNext = jest.fn();
  });

  describe("Error Code to Status Mapping", () => {
    it("should map error codes to correct HTTP status codes", () => {
      expect(ERROR_CODE_TO_STATUS[BOOKING_CODES.MENTOR_UNAVAILABLE]).toBe(409);
      expect(ERROR_CODE_TO_STATUS[NOT_FOUND_CODES.BOOKING_NOT_FOUND]).toBe(404);
      expect(ERROR_CODE_TO_STATUS[AUTH_CODES.INVALID_CREDENTIALS]).toBe(401);
      expect(ERROR_CODE_TO_STATUS[PAYMENT_CODES.UNSUPPORTED_CURRENCY]).toBe(500);
      expect(ERROR_CODE_TO_STATUS[VALIDATION_CODES.INVALID_EMAIL]).toBe(400);
    });
  });

  describe("AppError Class", () => {
    it("should create error with code and default message", () => {
      const error = new AppError(BOOKING_CODES.MENTOR_UNAVAILABLE);

      expect(error.code).toBe(BOOKING_CODES.MENTOR_UNAVAILABLE);
      expect(error.statusCode).toBe(409);
      expect(error.isOperational).toBe(true);
      expect(error.message).toBe("");
      expect(error.timestamp).toBeDefined();
    });

    it("should create error with custom message", () => {
      const error = new AppError(
        BOOKING_CODES.MENTOR_UNAVAILABLE,
        "Custom error message",
      );

      expect(error.code).toBe(BOOKING_CODES.MENTOR_UNAVAILABLE);
      expect(error.message).toBe("Custom error message");
    });

    it("should include error details", () => {
      const details = { mentorId: "m123", availableSlots: ["10:00", "14:00"] };
      const error = new AppError(
        BOOKING_CODES.MENTOR_UNAVAILABLE,
        "Mentor unavailable",
        details,
      );

      expect(error.details).toEqual(details);
    });

    it("should capture stack trace", () => {
      const error = new AppError(BOOKING_CODES.MENTOR_UNAVAILABLE);
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("AppError");
    });
  });

  describe("NotFoundError Class", () => {
    it("should create not found error", () => {
      const error = new NotFoundError(
        "Booking",
        "booking_123",
        NOT_FOUND_CODES.BOOKING_NOT_FOUND,
      );

      expect(error.code).toBe(NOT_FOUND_CODES.BOOKING_NOT_FOUND);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe("Booking (booking_123) not found");
      expect(error.details).toEqual({
        resourceType: "Booking",
        resourceId: "booking_123",
      });
    });

    it("should create not found error without resource ID", () => {
      const error = new NotFoundError(
        "User",
        undefined,
        NOT_FOUND_CODES.USER_NOT_FOUND,
      );

      expect(error.message).toBe("User not found");
    });
  });

  describe("ConflictError Class", () => {
    it("should create conflict error for already paid booking", () => {
      const error = new ConflictError(
        BOOKING_CODES.ALREADY_PAID,
        "Booking is already paid",
        { bookingId: "b123", paidAt: new Date() },
      );

      expect(error.code).toBe(BOOKING_CODES.ALREADY_PAID);
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe("Booking is already paid");
      expect(error.details?.bookingId).toBe("b123");
    });
  });

  describe("ValidationError Class", () => {
    it("should create validation error with field-level errors", () => {
      const fieldErrors = {
        email: ["Invalid email format"],
        password: ["Password must be at least 8 characters"],
      };
      const error = new ValidationError(
        fieldErrors,
        "Validation failed",
      );

      expect(error.code).toBe(VALIDATION_CODES.INVALID_INPUT);
      expect(error.statusCode).toBe(400);
      expect(error.fieldErrors).toEqual(fieldErrors);
      expect(error.details?.fieldErrors).toEqual(fieldErrors);
    });
  });

  describe("AuthenticationError Class", () => {
    it("should create authentication error", () => {
      const error = new AuthenticationError(
        AUTH_CODES.ACCOUNT_BANNED,
        "Account banned",
        { reason: "Terms violation" },
      );

      expect(error.code).toBe(AUTH_CODES.ACCOUNT_BANNED);
      expect(error.statusCode).toBe(403);
      expect(error.details?.reason).toBe("Terms violation");
    });
  });

  describe("BusinessLogicError Class", () => {
    it("should create business logic error", () => {
      const error = new BusinessLogicError(
        BUSINESS_CODES.DUPLICATE_REVIEW,
        "Review already exists",
      );

      expect(error.code).toBe(BUSINESS_CODES.DUPLICATE_REVIEW);
      expect(error.statusCode).toBe(409);
    });
  });

  describe("ExternalServiceError Class", () => {
    it("should create external service error with original error", () => {
      const originalError = new Error("Connection timeout");
      const error = new ExternalServiceError(
        "Stellar",
        SERVICE_CODES.TIMEOUT,
        "Failed to reach Stellar network",
        originalError,
        { retryable: true },
      );

      expect(error.code).toBe(SERVICE_CODES.TIMEOUT);
      expect(error.service).toBe("Stellar");
      expect(error.originalError).toBe(originalError);
      expect(error.details?.service).toBe("Stellar");
      expect(error.details?.retryable).toBe(true);
    });
  });

  describe("errorHandler Middleware", () => {
    it("should handle AppError with structured response", () => {
      const error = new AppError(
        BOOKING_CODES.MENTOR_UNAVAILABLE,
        "Mentor not available",
        { mentorId: "m123" },
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          code: BOOKING_CODES.MENTOR_UNAVAILABLE,
          message: "Mentor not available",
          details: { mentorId: "m123" },
          timestamp: expect.any(String),
          requestId: expect.any(String),
        }),
      );
    });

    it("should handle NotFoundError", () => {
      const error = new NotFoundError(
        "Booking",
        "b123",
        NOT_FOUND_CODES.BOOKING_NOT_FOUND,
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          code: NOT_FOUND_CODES.BOOKING_NOT_FOUND,
          message: "Booking (b123) not found",
        }),
      );
    });

    it("should handle ConflictError with details", () => {
      const error = new ConflictError(
        BOOKING_CODES.ALREADY_PAID,
        "Booking already paid (idempotent success)",
        {
          bookingId: "b123",
          paidAt: "2026-07-27T10:00:00Z",
        },
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          code: BOOKING_CODES.ALREADY_PAID,
          details: expect.objectContaining({
            bookingId: "b123",
            paidAt: "2026-07-27T10:00:00Z",
          }),
        }),
      );
    });

    it("should handle ValidationError with field errors", () => {
      const error = new ValidationError(
        {
          email: ["Invalid email"],
          password: ["Too short"],
        },
        "Validation failed",
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          code: VALIDATION_CODES.INVALID_INPUT,
          details: expect.objectContaining({
            fieldErrors: {
              email: ["Invalid email"],
              password: ["Too short"],
            },
          }),
        }),
      );
    });

    it("should include requestId in response", () => {
      (mockReq as any).requestId = "req_abc123";
      const error = new AppError(NOT_FOUND_CODES.USER_NOT_FOUND);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "req_abc123",
        }),
      );
    });

    it("should set trace headers", () => {
      const error = new AppError(NOT_FOUND_CODES.USER_NOT_FOUND);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith(
        "X-Request-ID",
        expect.any(String),
      );
      expect(setHeaderMock).toHaveBeenCalledWith(
        "X-Trace-ID",
        expect.any(String),
      );
    });

    it("should include stack trace in development mode", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const error = new AppError(NOT_FOUND_CODES.USER_NOT_FOUND);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.any(String),
          path: "/api/v1/bookings",
        }),
      );

      process.env.NODE_ENV = originalEnv;
    });

    it("should not include stack trace in production mode", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const error = new AppError(NOT_FOUND_CODES.USER_NOT_FOUND);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.not.objectContaining({
          stack: expect.any(String),
        }),
      );

      process.env.NODE_ENV = originalEnv;
    });

    it("should handle generic Error objects", () => {
      const error = new Error("Unknown error");

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          code: "SERVER_INTERNAL_ERROR",
          message: "Unknown error",
        }),
      );
    });
  });

  describe("Practical Error Scenarios", () => {
    it("should distinguish booking mentor unavailable from already paid", () => {
      const unavailableError = new ConflictError(
        BOOKING_CODES.MENTOR_UNAVAILABLE,
        "Mentor not available 2-5 PM",
        { availableSlots: ["10:00-12:00", "16:00-18:00"] },
      );

      const alreadyPaidError = new ConflictError(
        BOOKING_CODES.ALREADY_PAID,
        "Booking already paid",
        { paidAt: new Date() },
      );

      // Simulate two different error responses
      errorHandler(
        unavailableError,
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );
      const unavailableResponse = jsonMock.mock.calls[0][0];

      jsonMock.mockClear();
      statusMock.mockClear();

      errorHandler(
        alreadyPaidError,
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );
      const alreadyPaidResponse = jsonMock.mock.calls[0][0];

      // Client can distinguish these programmatically
      expect(unavailableResponse.code).toBe(BOOKING_CODES.MENTOR_UNAVAILABLE);
      expect(alreadyPaidResponse.code).toBe(BOOKING_CODES.ALREADY_PAID);

      // No need for string parsing
      expect(unavailableResponse.code).not.toBe(alreadyPaidResponse.code);
    });

    it("should provide internationalization-friendly error codes", () => {
      const errors = [
        new AppError(
          PAYMENT_CODES.UNSUPPORTED_CURRENCY,
          "Currency USD not supported",
        ),
        new AppError(PAYMENT_CODES.QUOTE_EXPIRED, "Exchange rate expired"),
        new AppError(
          PAYMENT_CODES.INSUFFICIENT_FUNDS,
          "Insufficient balance",
        ),
      ];

      const responses = errors.map((error) => {
        jsonMock.mockClear();
        statusMock.mockClear();

        errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
        return jsonMock.mock.calls[0][0];
      });

      // Client can use error.code as i18n key
      expect(responses[0].code).toBe(PAYMENT_CODES.UNSUPPORTED_CURRENCY);
      expect(responses[1].code).toBe(PAYMENT_CODES.QUOTE_EXPIRED);
      expect(responses[2].code).toBe(PAYMENT_CODES.INSUFFICIENT_FUNDS);

      // All are language-independent
      responses.forEach((response) => {
        expect(response.code).toMatch(/^[A-Z_]+$/);
      });
    });

    it("should provide context for retryable operations", () => {
      const externalError = new ExternalServiceError(
        "PaymentGateway",
        SERVICE_CODES.EXTERNAL_API_ERROR,
        "Payment gateway error",
        new Error("Connection timeout"),
        {
          retryable: true,
          backoffMs: 1000,
          attempt: 1,
          maxAttempts: 3,
        },
      );

      errorHandler(
        externalError,
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      const response = jsonMock.mock.calls[0][0];

      // Client can decide whether to retry
      expect(response.details?.retryable).toBe(true);
      expect(response.details?.backoffMs).toBe(1000);
      expect(response.details?.attempt).toBe(1);
    });
  });
});
