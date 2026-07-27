#!/usr/bin/env node

/**
 * Sunset Enforcement Readiness Check
 * 
 * Usage: npm run check:sunsets
 * 
 * Checks that:
 * 1. No versions are past their sunset date (unless active: false)
 * 2. All sunset versions have replacement versions configured
 * 3. Warns about sunsets within 30 days
 * 4. Prevents deployment if there are critical issues
 */

import { checkSunsetEnforcementReadiness, getSunsetVersions } from '../src/middleware/sunset-enforcement.middleware';

/**
 * Run the check
 */
function runCheck(): number {
  console.log('\n🌅 Checking API Sunset Enforcement...\n');

  const readiness = checkSunsetEnforcementReadiness();
  const sunsetVersions = getSunsetVersions();

  // Display all sunset versions
  if (sunsetVersions.length > 0) {
    console.log('📋 Sunset Versions:\n');
    for (const v of sunsetVersions) {
      const status = v.isAlreadySunset ? '⛔ SUNSET' : `⏱️  ${v.daysUntilSunset}d`;
      const arrow = v.isAlreadySunset ? '→' : '→';
      console.log(`  ${status} ${v.version} (${new Date(v.sunsetDate).toISOString().split('T')[0]}) ${arrow} ${v.replacementVersion || 'N/A'}`);
    }
    console.log();
  }

  // Display issues
  if (readiness.issues.length > 0) {
    console.error('❌ CRITICAL ISSUES:\n');
    for (const issue of readiness.issues) {
      console.error(`  • ${issue}`);
    }
    console.error();
  }

  // Display warnings
  if (readiness.warnings.length > 0) {
    console.warn('⚠️  WARNINGS:\n');
    for (const warning of readiness.warnings) {
      console.warn(`  • ${warning}`);
    }
    console.warn();
  }

  // Final status
  if (readiness.ready) {
    console.log('✅ Sunset enforcement ready for deployment\n');
    return 0;
  } else {
    console.error('❌ Sunset enforcement issues prevent deployment\n');
    console.error('   → Fix critical issues before deploying\n');
    return 1;
  }
}

// Run if called directly
if (require.main === module) {
  process.exit(runCheck());
}

export default runCheck;
