/**
 * bootstrap.ts — application entry point
 *
 * Loads secrets from the configured provider (AWS / Vault / env) BEFORE
 * any other module is imported, so that src/config/env.ts sees the final
 * values when it validates process.env on first require().
 */
import { loadSecrets } from "./config/secrets";

async function bootstrap() {
  await loadSecrets();
  // Dynamic import ensures config/env.ts is evaluated AFTER secrets are merged
  await import("./server");

  // Initialize scheduled dispute escalation cron job
  const { disputeEscalationJob } = await import("./jobs/disputeEscalation.job");
  disputeEscalationJob.initialize();
}

bootstrap().catch((err) => {
  process.stderr.write(`Fatal bootstrap error: ${err}\n`);
  process.exitCode = 1;
});
