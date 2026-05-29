/**
 * Jest globalTeardown — runs once in the main process after all test workers finish.
 *
 * Stops the PostgreSQL and Redis testcontainers that were started in globalSetup.
 * Because globalSetup and globalTeardown run in the same Node.js process,
 * the containerRegistry module is shared (via Node module cache) and holds
 * the stop callbacks.
 */
import registry from "./containerRegistry";

export default async function globalTeardown(): Promise<void> {
  if (registry.stopPg) {
    console.log("\n🐘 Stopping PostgreSQL container …");
    await registry.stopPg();
    console.log("   ✅ PostgreSQL container stopped");
  }

  if (registry.stopRedis) {
    console.log("🔴 Stopping Redis container …");
    await registry.stopRedis();
    console.log("   ✅ Redis container stopped");
  }
}
