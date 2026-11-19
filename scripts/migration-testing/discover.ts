import fs from "node:fs";
import path from "node:path";
import type { MigrationDiscovery, MigrationFile } from "./types";

export function discoverMigrations(migrationsDir: string): MigrationDiscovery {
  const names = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
  const migrations: MigrationFile[] = [];
  const invalidNames: string[] = [];

  for (const name of names) {
    const match = name.match(/^(\d+)_.*\.sql$/);
    if (!match) {
      invalidNames.push(name);
      continue;
    }
    migrations.push({ name, path: path.join(migrationsDir, name), prefix: Number(match[1]) });
  }

  migrations.sort((left, right) => left.prefix - right.prefix || left.name.localeCompare(right.name));
  const grouped = new Map<string, string[]>();
  for (const migration of migrations) {
    const key = String(migration.prefix).padStart(3, "0");
    grouped.set(key, [...(grouped.get(key) ?? []), migration.name]);
  }

  const duplicatePrefixes = Object.fromEntries(
    [...grouped.entries()].filter(([, entries]) => entries.length > 1),
  );
  return { migrations, duplicatePrefixes, invalidNames };
}