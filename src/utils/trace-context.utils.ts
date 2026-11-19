import { trace, context as otelContext, Context } from "@opentelemetry/api";
import { traceStore, TraceContext } from "../middleware/tracing.middleware";

/**
 * Trace fields to embed in BullMQ job payloads so worker logs can be
 * correlated back to the HTTP request that enqueued the job.
 */
export interface JobTraceData {
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
}

/**
 * Snapshot the current request's trace/correlation context for embedding
 * in a BullMQ job payload. Call this at the point a job is enqueued.
 */
export function captureJobTraceData(): JobTraceData {
  const requestContext: TraceContext | undefined = traceStore.getStore();
  const spanContext = trace.getActiveSpan()?.spanContext();

  return {
    requestId: requestContext?.requestId,
    correlationId: requestContext?.correlationId,
    traceId: spanContext?.traceId,
    spanId: spanContext?.spanId,
  };
}

/**
 * Run `fn` with the trace/correlation context restored from job data, so
 * that logger.mixin() picks up the same requestId/traceId as the original
 * HTTP request, and any spans started inside `fn` link to that traceId via
 * a remote parent span context.
 */
export async function runWithJobTraceContext<T>(
  jobTraceData: JobTraceData | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const restoredTraceContext: TraceContext = {
    requestId: jobTraceData?.requestId ?? "unknown",
    correlationId: jobTraceData?.correlationId ?? "unknown",
    startTime: Date.now(),
  };

  const run = () => traceStore.run(restoredTraceContext, fn);

  if (jobTraceData?.traceId && jobTraceData?.spanId) {
    const remoteParent: Context = trace.setSpanContext(otelContext.active(), {
      traceId: jobTraceData.traceId,
      spanId: jobTraceData.spanId,
      traceFlags: 1,
      isRemote: true,
    });
    return otelContext.with(remoteParent, run);
  }

  return run();
}

/**
 * Return the current request's correlation ID (issue #1308).
 * Falls back to "unknown" outside a tracing context so outbound
 * callers never crash.
 */
export function getCorrelationId(): string {
  return traceStore.getStore()?.correlationId ?? "unknown";
}

export function getRequestId(): string {
  return traceStore.getStore()?.requestId ?? "unknown";
}

/**
 * Build outbound propagation headers carrying the current correlation context.
 */
export function buildTraceHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "X-Correlation-ID": getCorrelationId(),
    "X-Request-ID": getRequestId(),
    ...extra,
  };
}

