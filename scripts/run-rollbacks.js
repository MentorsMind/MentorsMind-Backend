#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const OUT_DIR = path.resolve(__dirname, '../database/migrations_down');
const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Please set DATABASE_URL to run rollbacks');
  process.exit(1);
}

async function run() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // read down files; match originals to ensure order
  const originals = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  const downFiles = originals.map(f => f.replace(/\.sql$/, '.down.sql')).map(f => path.join(OUT_DIR, f));

  // execute in reverse order
  for (let i = downFiles.length - 1; i >= 0; i--) {
    const file = downFiles[i];
    if (!fs.existsSync(file)) {
      console.warn('Missing down-file, skipping:', file);
      continue;
    }
    const sql = fs.readFileSync(file, 'utf8');
    console.log('Running rollback:', path.basename(file));
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('Rolled back:', path.basename(file));
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Rollback failed for', file, err.message);
      // stop on first failure to preserve state
      await client.end();
      process.exit(2);
    }
  }

  await client.end();
  console.log('All rollbacks executed');
}

run().catch(err => { console.error(err); process.exit(1); });
