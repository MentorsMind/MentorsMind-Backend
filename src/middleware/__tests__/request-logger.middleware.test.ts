/**
 * request-logger.middleware.test.ts
 *
 * pino-http is a factory that returns a standard Express middleware function.
 * We verify the middleware mounts without error and calls next().
 */
import { requestLoggerMiddleware } from "../request-logger.middleware";

describe("requestLoggerMiddleware", () => {
  it("is a function (valid Express middleware)", () => {
    expect(typeof requestLoggerMiddleware).toBe("function");
  });

  it("calls next() when invoked", () => {
    const req: any = {
      method: "GET",
      url: "/api/v1/health",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    };
    const res: any = {
      locals: { requestId: "test-req-id", userId: "user-1" },
      statusCode: 200,
      on: jest.fn(),
      getHeader: jest.fn(),
      setHeader: jest.fn(),
    };
    const next = jest.fn();

    requestLoggerMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
