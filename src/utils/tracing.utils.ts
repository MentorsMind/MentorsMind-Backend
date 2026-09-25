import { logger } from "./logger.utils";

export async function withSpan<T>(
  spanName: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  logger.info(`Span started: ${spanName}`, context);
  const startTime = process.hrtime.bigint();
  try {
    const result = await fn();
    const endTime = process.hrtime.bigint();
    const durationNs = endTime - startTime;
    logger.info(`Span finished: ${spanName}`, { durationNs: Number(durationNs), ...context });
    return result;
  } catch (error) {
    const endTime = process.hrtime.bigint();
    const durationNs = endTime - startTime;
    logger.error(`Span failed: ${spanName}`, { durationNs: Number(durationNs), error, ...context });
    throw error;
  }
}