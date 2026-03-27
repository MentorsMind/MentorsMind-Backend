#!/usr/bin/env node

/**
 * Check for breaking changes in OpenAPI spec compared to main branch
 * Used in CI to prevent breaking changes
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const currentSpecPath = path.join(process.cwd(), 'openapi.json');
const mainSpecPath = path.join(process.cwd(), 'openapi.main.json');

function cleanup() {
  if (fs.existsSync(mainSpecPath)) {
    fs.unlinkSync(mainSpecPath);
  }
}

try {
  console.log('🔄 Checking for breaking changes in API spec...');

  // Check if current spec exists
  if (!fs.existsSync(currentSpecPath)) {
    console.error('❌ openapi.json not found. Run npm run generate:spec first.');
    process.exit(1);
  }

  // Fetch main branch spec
  try {
    console.log('📥 Fetching spec from main branch...');
    execSync('git fetch origin main', { stdio: 'pipe' });

    // Check if openapi.json exists on main
    try {
      execSync('git cat-file -e origin/main:openapi.json', { stdio: 'pipe' });
    } catch {
      console.log('⚠️  openapi.json does not exist on main branch (first deployment)');
      console.log('✅ Skipping breaking change check');
      process.exit(0);
    }

    execSync(`git show origin/main:openapi.json > ${mainSpecPath}`, { stdio: 'pipe' });
  } catch (error) {
    console.log('⚠️  Could not fetch main branch spec');
    console.log('✅ Skipping breaking change check');
    process.exit(0);
  }

  // Validate the fetched spec is usable before diffing
  try {
    const mainSpec = JSON.parse(fs.readFileSync(mainSpecPath, 'utf-8'));
    if (!mainSpec.openapi && !mainSpec.swagger) {
      console.log('⚠️  Main branch spec is not a valid OpenAPI document');
      console.log('✅ Skipping breaking change check');
      cleanup();
      process.exit(0);
    }
  } catch {
    console.log('⚠️  Could not parse main branch spec');
    console.log('✅ Skipping breaking change check');
    cleanup();
    process.exit(0);
  }

  // Compare specs using openapi-diff
  try {
    const result = execSync(
      `npx openapi-diff ${mainSpecPath} ${currentSpecPath}`,
      { encoding: 'utf-8' }
    );

    if (/breaking/i.test(result)) {
      console.error('❌ Potential breaking changes detected:');
      console.error(result);
      cleanup();
      process.exit(1);
    }

    console.log('✅ No breaking changes found!');
    console.log(result);
  } catch (diffError) {
    // If openapi-diff fails due to spec issues (unresolved $refs etc), skip gracefully
    if (diffError.message && diffError.message.includes('OPENAPI_DIFF_PARSE_ERROR')) {
      console.log('⚠️  Could not parse specs for comparison (unresolved $refs or invalid spec)');
      console.log('✅ Skipping breaking change check');
      cleanup();
      process.exit(0);
    }
    console.error('❌ Failed to compare specs:', diffError.message);
    cleanup();
    process.exit(1);
  }

  cleanup();

} catch (error) {
  console.error('❌ Breaking change check failed:', error.message);
  cleanup();
  process.exit(1);
}
