import { Request, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../auth.middleware";
import jwt from "jsonwebtoken";
import { ErrorCode } from "../../errors/error-codes";

jest.mock("jsonwebtoken");
jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}));

describe("Auth Middleware - authenticate", () => {
  let req: Partial<AuthenticatedRequest>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      headers: {
        authorization: "Bearer valid_token",
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
    
    // Default valid token
    (jwt.decode as jest.Mock).mockReturnValue({
      header: { alg: "HS256" },
    });
    
    (jwt.verify as jest.Mock).mockReturnValue({
      sub: "user_123",
      role: "learner",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should successfully set req.user and call next on happy path", async () => {
    await authenticate(req as AuthenticatedRequest, res as Response, next);
    
    expect(req.user).toBeDefined();
    expect(req.user?.id).toBe("user_123");
    expect(req.user?.userId).toBe("user_123");
    expect(next).toHaveBeenCalledWith(); // called without error
  });

  it("should throw UNAUTHORIZED AppError if req.user is set but id is missing", async () => {
    // Force jwt.verify to return an object without a sub
    (jwt.verify as jest.Mock).mockReturnValue({
      role: "learner",
    });

    await authenticate(req as AuthenticatedRequest, res as Response, next);

    expect(next).toHaveBeenCalled();
    const errorPassedToNext = (next as jest.Mock).mock.calls[0][0];
    expect(errorPassedToNext).toBeDefined();
    expect(errorPassedToNext.code).toBe(ErrorCode.AUTH_UNAUTHORIZED);
    expect(errorPassedToNext.statusCode).toBe(401);
  });
});
