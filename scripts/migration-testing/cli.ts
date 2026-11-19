import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { MigrationTestRunner } from "./runner";

async function main(): Promise<void> {
  if (process.env.MIGRATION_TEST_ALLOW_DESTRUCTIVE !== "true") {
    throw new Error("Set MIGRATION_TEST_ALLOW_DESTRUCTIVE=true on a disposable database to run migration tests");
  }
  const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("MIGRATION_TEST_DATABASE_URL is required");

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const runner = new MigrationTestRunner(
      { query: (sql) => client.query(sql).then((result) => ({ rows: result.rows as Array<Record<string, unknown>> })) },
      path.resolve(process.cwd(), "database/migrations"),
    );
    const report = await runner.run();
    await fs.writeFile(process.env.MIGRATION_TEST_REPORT ?? "migration-test-report.json", `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.orderingValid) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});