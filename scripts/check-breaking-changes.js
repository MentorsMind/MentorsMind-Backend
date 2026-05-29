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
    execSync(`git show origin/main:openapi.json > ${mainSpecPath}`, { stdio: 'pipe' });
  } catch (error) {
    console.log('⚠️  Could not fetch main branch spec (might be first deployment)');
    console.log('✅ Skipping breaking change check');
    process.exit(0);
  }
  
  // Compare specs using openapi-diff
  try {
    const result = execSync(
      `npx openapi-diff ${mainSpecPath} ${currentSpecPath} --format json`,
      { encoding: 'utf-8' }
    );
    
    const diff = JSON.parse(result);
    
    // Check for breaking changes
    const breakingChanges = diff.breakingChanges || [];
    
    if (breakingChanges.length > 0) {
      console.error('❌ Breaking changes detected:');
      breakingChanges.forEach((change, index) => {
        console.error(`\n${index + 1}. ${change.type}: ${change.action}`);
        console.error(`   Path: ${change.path}`);
        console.error(`   Details: ${change.details || 'N/A'}`);
      });
      console.error('\n💡 Breaking changes will break frontend clients!');
      console.error('   Consider versioning the API or making changes backward-compatible.');
      process.exit(1);
    }
    
    // Report non-breaking changes
    const nonBreakingChanges = diff.nonBreakingChanges || [];
    if (nonBreakingChanges.length > 0) {
      console.log(`✅ ${nonBreakingChanges.length} non-breaking change(s) detected`);
      nonBreakingChanges.slice(0, 5).forEach((change, index) => {
        console.log(`   ${index + 1}. ${change.type}: ${change.action}`);
      });
      if (nonBreakingChanges.length > 5) {
        console.log(`   ... and ${nonBreakingChanges.length - 5} more`);
      }
    } else {
      console.log('✅ No changes detected in API spec');
    }
    
    console.log('\n✅ No breaking changes found!');
    
  } catch (error) {
    // openapi-diff might not support JSON format, try text
    try {
      const result = execSync(
        `npx openapi-diff ${mainSpecPath} ${currentSpecPath}`,
        { encoding: 'utf-8' }
      );
      
      // Simple check: if output contains "breaking" (case insensitive)
      if (/breaking/i.test(result)) {
        console.error('❌ Potential breaking changes detected:');
        console.error(result);
        process.exit(1);
      }
      
      console.log('✅ No breaking changes found!');
      console.log(result);
    } catch (diffError) {
      console.error('❌ Failed to compare specs:', diffError.message);
      process.exit(1);
    }
  }
  
  // Cleanup
  if (fs.existsSync(mainSpecPath)) {
    fs.unlinkSync(mainSpecPath);
  }
  
} catch (error) {
  console.error('❌ Breaking change check failed:', error.message);
  process.exit(1);
}
