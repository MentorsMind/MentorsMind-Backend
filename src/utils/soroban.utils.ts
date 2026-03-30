import { AuditLoggerService } from '../services/audit-logger.service';
import { LogLevel, AuditAction } from './log-formatter.utils';
import { logger } from './logger.utils';

export interface SorobanInvocationContext {
  method: string;
  contractAddress: string;
  entityId?: string;
  userId?: string;
  maxAttempts?: number;
  initialDelayMs?: number;
}

export interface SorobanInvocationExecutor<TArgs, TResult> {
  simulate: (args: TArgs) => Promise<void>;
  submit: (args: TArgs) => Promise<TResult>;
}

export const SOROBAN_MAX_RETRIES = 5;
export const SOROBAN_POLL_INTERVAL_MS = 30_000;

export async function executeSorobanInvocation<TArgs, TResult>(
  executor: SorobanInvocationExecutor<TArgs, TResult>,
  args: TArgs,
  context: SorobanInvocationContext,
): Promise<TResult> {
  const maxAttempts = context.maxAttempts ?? SOROBAN_MAX_RETRIES;
  const initialDelayMs = context.initialDelayMs ?? 1_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await executor.simulate(args);
      return await executor.submit(args);
    } catch (error) {
      lastError = error;
      logger.warn('Soroban contract invocation attempt failed', {
        attempt,
        maxAttempts,
        method: context.method,
        contractAddress: context.contractAddress,
        error: error instanceof Error ? error.message : String(error),
      });

      if (attempt < maxAttempts) {
        await sleep(initialDelayMs * attempt);
      }
    }
  }

  await alertAdminSorobanFailure(context, lastError);

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(
    `Soroban invocation failed for ${context.method} after ${maxAttempts} attempts`,
  );
}

export function normalizeSplitPercentage(
  splitPercentage: number | undefined,
): number {
  if (splitPercentage === undefined) {
    return 100;
  }

  if (!Number.isFinite(splitPercentage)) {
    throw new Error('Split percentage must be a finite number');
  }

  if (splitPercentage < 0 || splitPercentage > 100) {
    throw new Error('Split percentage must be between 0 and 100');
  }

  return Number(splitPercentage.toFixed(2));
}

export function asStringId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

async function alertAdminSorobanFailure(
  context: SorobanInvocationContext,
  error: unknown,
): Promise<void> {
  const message =
    error instanceof Error ? error.message : 'Unknown Soroban invocation error';

  logger.error('Soroban invocation exhausted retries', {
    method: context.method,
    contractAddress: context.contractAddress,
    entityId: context.entityId,
    error: message,
  });

  await AuditLoggerService.logEvent({
    level: LogLevel.ERROR,
    action: AuditAction.ADMIN_ACTION,
    message: `Soroban invocation failed after retries: ${context.method}`,
    userId: context.userId,
    entityType: 'soroban_escrow',
    entityId: context.entityId,
    metadata: {
      contractAddress: context.contractAddress,
      method: context.method,
      error: message,
    },
  }).catch(() => {
    // Do not hide the original error when alert persistence fails.
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
