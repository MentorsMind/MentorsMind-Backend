import { traceStore } from "../../middleware/tracing.middleware";
import {
  getCorrelationId,
  getRequestId,
  buildTraceHeaders,
} from "../trace-context.utils";

describe("trace propagation (issue #1308)", () => {
  it("forwards the correlation id from AsyncLocalStorage", () => {
    traceStore.run(
      { requestId: "r-1", correlationId: "c-123", startTime: Date.now() },
      () => {
        expect(getCorrelationId()).toBe("c-123");
        expect(getRequestId()).toBe("r-1");
        expect(buildTraceHeaders()["X-Correlation-ID"]).toBe("c-123");
        expect(buildTraceHeaders()["X-Request-ID"]).toBe("r-1");
      },
    );
  });

  it("falls back to unknown outside a context", () => {
    expect(getCorrelationId()).toBe("unknown");
    expect(buildTraceHeaders()["X-Correlation-ID"]).toBe("unknown");
  });
});
