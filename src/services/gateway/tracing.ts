/**
 * Trace propagation across service hops (issue #860).
 *
 * The repo already ships `@opentelemetry/*`. What a gateway additionally needs
 * is to *forward* context on every hop, because a trace that stops at the
 * gateway is worse than no trace: it makes a distributed call look local.
 *
 * W3C `traceparent` is emitted so any OTel-compatible collector stitches the
 * spans together without bespoke handling.
 */

import crypto from "crypto";
import type { Request } from "express";

const TRACEPARENT = "traceparent";
const TRACESTATE = "tracestate";
const VERSION = "00";
const SAMPLED = "01";

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

const hex = (bytes: number): string => crypto.randomBytes(bytes).toString("hex");

/** Parse a W3C traceparent, or null when absent/malformed. */
export function parseTraceparent(value: string | undefined): TraceContext | null {
  if (!value) return null;
  const parts = value.trim().split("-");
  if (parts.length !== 4) return null;

  const [, traceId, spanId, flags] = parts;
  // All-zero ids are reserved and must be treated as absent.
  if (!/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/.test(spanId) || /^0+$/.test(spanId)) return null;

  return {
    traceId,
    spanId,
    sampled: (parseInt(flags, 16) & 0x01) === 0x01,
  };
}

export function formatTraceparent(context: TraceContext): string {
  return `${VERSION}-${context.traceId}-${context.spanId}-${context.sampled ? SAMPLED : "00"}`;
}

/** Continue an inbound trace, or start one when there is none. */
export function traceContextFor(req: Request): TraceContext {
  const inbound = parseTraceparent(req.headers[TRACEPARENT] as string | undefined);

  if (inbound) {
    // Same trace, new span for this hop — that is what makes the gateway
    // visible as a link in the chain rather than a black box.
    return { traceId: inbound.traceId, spanId: hex(8), sampled: inbound.sampled };
  }

  return { traceId: hex(16), spanId: hex(8), sampled: true };
}

/** Headers to attach to an outbound service call. */
export function buildTraceHeaders(req: Request): Record<string, string> {
  const context = traceContextFor(req);
  const headers: Record<string, string> = {
    [TRACEPARENT]: formatTraceparent(context),
  };

  const state = req.headers[TRACESTATE];
  if (typeof state === "string" && state) headers[TRACESTATE] = state;

  // Preserve the app's own correlation id alongside the W3C context so
  // existing log queries keep working during the migration.
  const correlationId = req.headers["x-correlation-id"] ?? req.headers["x-request-id"];
  if (typeof correlationId === "string" && correlationId) {
    headers["x-correlation-id"] = correlationId;
  }

  return headers;
}
