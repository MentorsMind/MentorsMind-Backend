import { errorHandler } from "../errorHandler";
import { TenantContext } from "../../utils/tenant-context.utils";
import * as Sentry from "@sentry/node";

const scope = { setUser: jest.fn(), setContext: jest.fn(), setTag: jest.fn(), setExtra: jest.fn() };

jest.mock("@sentry/node", () => ({
  withScope: jest.fn((cb: (s: unknown) => void) => cb(scope)),
  captureException: jest.fn(),
}));
jest.mock("../../services/database.service", () => ({ CircuitBreakerError: class CircuitBreakerError extends Error {} }));
jest.mock("../../services/oracle.service", () => ({ OracleUnavailableError: class OracleUnavailableError extends Error {} }));
jest.mock("../tracing.middleware", () => ({ traceStore: { getStore: () => undefined } }));
jest.mock("../../utils/logger.utils", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const makeRes = () => {
  const res: any = { locals: {} };
  res.setHeader = jest.fn();
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const req: any = { method: "GET", path: "/x", headers: {}, ip: "127.0.0.1" };

describe("errorHandler Sentry tenant scope", () => {
  beforeEach(() => jest.clearAllMocks());

  it("tags and annotates the Sentry scope with the current tenant id", () => {
    TenantContext.run("tenant-42", () => {
      errorHandler(Object.assign(new Error("boom"), { statusCode: 500 }), req, makeRes(), jest.fn());
    });
    expect(scope.setTag).toHaveBeenCalledWith("tenant_id", "tenant-42");
    expect(scope.setExtra).toHaveBeenCalledWith("tenant_id", "tenant-42");
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("uses 'none' outside a tenant context", () => {
    errorHandler(Object.assign(new Error("boom"), { statusCode: 500 }), req, makeRes(), jest.fn());
    expect(scope.setTag).toHaveBeenCalledWith("tenant_id", "none");
  });

  it("still captures the exception when tenant lookup throws", () => {
    scope.setTag.mockImplementationOnce(() => {
      throw new Error("scope failure");
    });
    const res = makeRes();
    errorHandler(Object.assign(new Error("boom"), { statusCode: 500 }), req, res, jest.fn());
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it.each([403, 409, 422])("reports %i operational client errors", (statusCode) => {
    const error = Object.assign(new Error("operational client failure"), { statusCode });
    errorHandler(error, req, makeRes(), jest.fn());

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(scope.setContext).toHaveBeenCalledWith(
      "request",
      expect.objectContaining({ statusCode }),
    );
  });

  it("does not report routine 4xx errors", () => {
    errorHandler(Object.assign(new Error("bad"), { statusCode: 400 }), req, makeRes(), jest.fn());
    expect(scope.setTag).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("does not set empty request or trace headers when no IDs are available", () => {
    const res = makeRes();
    errorHandler(Object.assign(new Error("bad"), { statusCode: 400 }), req, res, jest.fn());

    expect(res.setHeader).not.toHaveBeenCalledWith("X-Request-ID", "");
    expect(res.setHeader).not.toHaveBeenCalledWith("X-Trace-ID", "");
  });

  it("sets the resolved request ID and trace ID on the error response", () => {
    const request = {
      ...req,
      requestId: "generated-request-id",
      traceId: "generated-trace-id",
    };
    const res = makeRes();

    errorHandler(Object.assign(new Error("bad"), { statusCode: 400 }), request, res, jest.fn());

    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", "generated-request-id");
    expect(res.setHeader).toHaveBeenCalledWith("X-Trace-ID", "generated-trace-id");
  });
});
