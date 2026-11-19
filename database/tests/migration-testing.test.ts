import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverMigrations } from "../../scripts/migration-testing/discover";
import { MigrationTestRunner, ROLLBACK_SQL } from "../../scripts/migration-testing/runner";

function fixtureDirectory(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "migration-tests-"));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content);
  return directory;
}

describe("migration testing framework", () => {
  it("detects invalid names and duplicate migration prefixes", () => {
    const discovery = discoverMigrations(fixtureDirectory({
      "001_users.sql": "CREATE TABLE users (id integer primary key);",
      "001_wallets.sql": "CREATE TABLE wallets (id integer primary key);",
      "bad-name.sql": "SELECT 1;",
    }));

    expect(discovery.invalidNames).toEqual(["bad-name.sql"]);
    expect(discovery.duplicatePrefixes["001"]).toEqual(["001_users.sql", "001_wallets.sql"]);
  });

  it("applies migrations, measures them, and verifies rollback", async () => {
    const queries: string[] = [];
    let rolledBack = false;
    const executor = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql === ROLLBACK_SQL) rolledBack = true;
        if (sql.includes("information_schema")) {
          return { rows: [{ tableCount: rolledBack ? 0 : 2, foreignKeyCount: rolledBack ? 0 : 1, primaryKeyCount: rolledBack ? 0 : 2, migrationTablePresent: rolledBack ? 0 : 1 }] };
        }
        return { rows: [] };
      },
    };
    const runner = new MigrationTestRunner(executor, fixtureDirectory({
      "001_users.sql": "CREATE TABLE users (id integer primary key);",
      "002_wallets.sql": "CREATE TABLE wallets (id integer primary key);",
    }));
    const report = await runner.run();

    expect(report.migrationCount).toBe(2);
    expect(report.applied.every((migration) => migration.succeeded)).toBe(true);
    expect(report.applied.every((migration) => migration.durationMs >= 0)).toBe(true);
    expect(report.rollbackVerified).toBe(true);
    expect(queries).toContain(ROLLBACK_SQL);
  });
});