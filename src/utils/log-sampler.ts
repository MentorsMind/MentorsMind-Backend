/**
 * Small utility to support log sampling for high-volume events.
 *
 * Usage:
 *   import { sampleLog } from './utils/log-sampler';
 *   sampleLog(logger, 'info', 0.01, 'metric.event', { foo: 'bar' });
 */
import type pino from "pino";

export function sampleLog(
  logger: pino.Logger,
  level: "fatal" | "error" | "warn" | "info" | "debug" | "trace",
  rate: number,
  msg: string,
  payload?: Record<string, unknown>,
) {
  if (rate <= 0) return;
  if (rate >= 1 || Math.random() < rate) {
    (logger as any)[level](payload ?? {}, msg);
  }
}
