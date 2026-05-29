#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');

function getStagedFiles() {
  const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  }).trim();

  if (!output) {
    return [];
  }

  return output.split('\n').filter(Boolean);
}

const stagedFiles = getStagedFiles().filter((file) => {
  if (!/\.(ts|js)$/i.test(file)) {
    return false;
  }

  if (file.startsWith('database/migrations')) {
    return false;
  }

  if (file.startsWith('src/__tests__') || file.startsWith('src/tests')) {
    return false;
  }

  return true;
});

const findings = [];

for (const file of stagedFiles) {
  if (!fs.existsSync(file)) {
    continue;
  }

  const contents = fs.readFileSync(file, 'utf8');
  const lines = contents.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.includes('CREATE TABLE IF NOT EXISTS')) {
      findings.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (findings.length > 0) {
  console.error('ERROR: Runtime DDL found in staged files outside migration files.');
  console.error('Please move table creation statements into database migration files.');
  console.error('Found the following occurrences:');
  findings.forEach((match) => console.error(`  - ${match}`));
  process.exit(1);
}

process.exit(0);
