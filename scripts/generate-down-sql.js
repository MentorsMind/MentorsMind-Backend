#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations');
const OUT_DIR = path.resolve(__dirname, '../database/migrations_down');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));

function generateDown(sql) {
  const lines = sql.split(/;\s*\n/);
  const drops = [];

  for (const chunk of lines) {
    const s = chunk.trim();
    if (!s) continue;

    // CREATE TABLE ...
    const createTable = s.match(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(["`]?)([a-zA-Z0-9_\.]+)\2/i);
    if (createTable) {
      const tableName = createTable[3];
      drops.push(`DROP TABLE IF EXISTS ${tableName} CASCADE;`);
      continue;
    }

    // ALTER TABLE ... ADD COLUMN
    const alterAdd = s.match(/ALTER\s+TABLE\s+(["`]?)([a-zA-Z0-9_\.]+)\1\s+ADD\s+COLUMN\s+(["`]?)([a-zA-Z0-9_]+)\3/i);
    if (alterAdd) {
      const tbl = alterAdd[2];
      const col = alterAdd[4];
      drops.push(`ALTER TABLE ${tbl} DROP COLUMN IF EXISTS ${col} CASCADE;`);
      continue;
    }

    // CREATE INDEX ... ON ...
    const idx = s.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?(["`]?)([a-zA-Z0-9_]+)\3/i);
    if (idx) {
      const idxName = idx[4];
      drops.push(`DROP INDEX IF EXISTS ${idxName} CASCADE;`);
      continue;
    }

    // CREATE VIEW
    const view = s.match(/CREATE\s+VIEW\s+(IF\s+NOT\s+EXISTS\s+)?(["`]?)([a-zA-Z0-9_\.]+)\2/i);
    if (view) {
      const viewName = view[3];
      drops.push(`DROP VIEW IF EXISTS ${viewName} CASCADE;`);
      continue;
    }

    // CREATE FUNCTION
    const fn = s.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(["`]?)([a-zA-Z0-9_\.]+)\2/i);
    if (fn) {
      const fnName = fn[3];
      drops.push(`DROP FUNCTION IF EXISTS ${fnName} CASCADE;`);
      continue;
    }

    // Default: emit a comment asking for manual rollback
    drops.push(`-- MANUAL REVIEW REQUIRED: cannot auto-generate rollback for this statement\n-- Original:\n-- ${s.split('\n').map(l=>l.trim()).join(' ')}\n`);
  }

  // Always wrap in transaction
  return `BEGIN;\n${drops.join('\n')}\nCOMMIT;\n`;
}

for (const file of files) {
  const full = path.join(MIGRATIONS_DIR, file);
  const sql = fs.readFileSync(full, 'utf8');
  const downSql = generateDown(sql);
  const outName = file.replace(/\.sql$/, '.down.sql');
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, `-- Auto-generated rollback for ${file}\n-- PLEASE REVIEW before running on production\n\n${downSql}`);
  console.log('Generated', outPath);
}

console.log('Done generating down SQL files in', OUT_DIR);
