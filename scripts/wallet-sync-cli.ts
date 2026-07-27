#!/usr/bin/env node

/**
 * Wallet Sync CLI Tool
 * 
 * Manual operations for wallet balance synchronization:
 * - Sync individual or multiple wallets
 * - Audit and review drift discrepancies
 * - Resolve flagged issues
 * - Generate sync reports
 * 
 * Usage:
 * npx ts-node scripts/wallet-sync-cli.ts [command] [options]
 * 
 * Commands:
 * - sync-user <userId>: Sync a single user's wallet
 * - sync-all: Sync all active wallets
 * - audit-issues: Show unresolved drift issues
 * - resolve-issue <auditId> <action>: Mark an issue as resolved
 * - stats [days]: Show sync statistics for last N days
 * - test: Run diagnostic test on a wallet
 */

import { WalletSyncService } from '../src/services/wallet-sync.service';
import { WalletModel } from '../src/models/wallet.model';
import { stellarService } from '../src/services/stellar.service';
import { db } from '../src/config/database';
import { logger } from '../src/utils/logger.utils';

const args = process.argv.slice(2);
const command = args[0];

/**
 * Sync a single user's wallet
 */
async function syncUser(userId: string): Promise<void> {
  console.log(`\n🔄 Syncing wallet for user ${userId}...\n`);

  try {
    const result = await WalletSyncService.syncWallet(userId, 'manual');

    console.log(`Stellar Address: ${result.stellarAddress}`);
    console.log(`Sync Duration: ${result.metadata.duration_ms}ms\n`);

    if (result.hadDrift) {
      console.log(`⚠️  Drift Detected: ${result.driftedAssets.length} asset(s)\n`);
      console.table(
        result.balances.map(b => ({
          Asset: b.assetCode,
          'On-Chain': b.onChainBalance,
          'Database': b.dbBalance,
          Drift: b.drift,
          'Drift %': b.driftPercentage.toFixed(2),
          Status: b.hasDrift ? '❌' : '✅',
        }))
      );
    } else {
      console.log(`✅ Wallets are in sync\n`);
      console.table(
        result.balances.map(b => ({
          Asset: b.assetCode,
          Balance: b.onChainBalance,
          Status: '✅',
        }))
      );
    }

    if (result.reconciled) {
      console.log(`\n✅ Drift auto-corrected in database\n`);
    }

    console.log(`Source: ${result.metadata.source}`);
    console.log(`Timestamp: ${result.metadata.timestamp}\n`);
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

/**
 * Sync all active wallets
 */
async function syncAll(options?: { concurrency?: number }): Promise<void> {
  console.log(`\n🔄 Syncing all active wallets...\n`);

  try {
    const query = 'SELECT user_id FROM wallets WHERE status = $1';
    const { rows } = await db.query(query, ['active']);
    const userIds = rows.map(r => r.user_id);

    if (userIds.length === 0) {
      console.log('No active wallets found.\n');
      return;
    }

    console.log(`Found ${userIds.length} active wallets\n`);

    const results = await WalletSyncService.syncWallets(userIds, 'manual', {
      concurrency: options?.concurrency || 5,
    });

    const withDrift = results.filter(r => r.hadDrift);
    const totalDrift = withDrift.length;

    console.log(`\n✅ Sync Complete\n`);
    console.log(`Total Wallets: ${results.length}`);
    console.log(`Wallets with Drift: ${totalDrift}`);
    console.log(`Drift Rate: ${((totalDrift / results.length) * 100).toFixed(2)}%\n`);

    if (totalDrift > 0) {
      console.log(`⚠️  Wallets with drift:\n`);
      withDrift.forEach(r => {
        console.log(
          `  • ${r.userId} (${r.driftedAssets.join(', ')})`
        );
      });
      console.log();
    }
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

/**
 * Show unresolved drift issues
 */
async function auditIssues(limit = 20): Promise<void> {
  console.log(`\n🔍 Unresolved Drift Issues (latest ${limit})\n`);

  try {
    const issues = await WalletSyncService.getUnresolvedDriftIssues(limit);

    if (issues.length === 0) {
      console.log('✅ No unresolved issues\n');
      return;
    }

    console.table(
      issues.map(i => ({
        'Audit ID': i.id.substring(0, 8),
        'User ID': i.user_id.substring(0, 8),
        Asset: i.asset_code,
        'On-Chain': i.on_chain_balance,
        Database: i.db_balance,
        Drift: i.drift_amount,
        'Drift %': i.drift_percentage.toFixed(2),
        Source: i.sync_source,
        Created: new Date(i.created_at).toLocaleString(),
      }))
    );

    console.log(
      `\nTo resolve an issue: npm run wallet:resolve-issue <auditId> <action>\n`
    );
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

/**
 * Resolve a drift issue
 */
async function resolveIssue(
  auditId: string,
  action: 'confirmed_correct' | 'corrected' | 'ignored',
  notes?: string
): Promise<void> {
  console.log(`\n🔧 Resolving drift issue ${auditId}...\n`);

  try {
    await WalletSyncService.resolveDriftIssue(auditId, action, notes);
    console.log(`✅ Issue resolved as: ${action}`);
    if (notes) {
      console.log(`   Notes: ${notes}`);
    }
    console.log();
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

/**
 * Show sync statistics
 */
async function showStats(days = 7): Promise<void> {
  console.log(`\n📊 Wallet Sync Statistics (Last ${days} days)\n`);

  try {
    const stats = await WalletSyncService.getSyncStatistics(days);

    console.log(`Total Active Wallets: ${stats.totalWallets}`);
    console.log(`Wallets with Drift: ${stats.walletsWithDrift}`);
    console.log(`Drift Rate: ${stats.driftPercentage.toFixed(2)}%`);
    console.log(`Average Drift Amount: ${stats.averageDriftAmount}\n`);

    if (stats.mostCommonlyDriftedAssets.length > 0) {
      console.log('Most Commonly Drifted Assets:\n');
      console.table(stats.mostCommonlyDriftedAssets);
    }

    console.log();
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

/**
 * Run diagnostic test on a wallet
 */
async function testWallet(userId: string): Promise<void> {
  console.log(`\n🧪 Running diagnostic test for user ${userId}...\n`);

  try {
    const wallet = await WalletModel.findByUserId(userId);
    if (!wallet) {
      console.log('❌ Wallet not found\n');
      process.exit(1);
    }

    console.log(`Wallet ID: ${wallet.id}`);
    console.log(`Stellar Address: ${wallet.stellar_public_key}`);
    console.log(`Status: ${wallet.status}`);
    console.log(`Created: ${wallet.created_at}\n`);

    // Test 1: Can we fetch on-chain account?
    console.log('Test 1: Fetching on-chain account...');
    try {
      const account = await stellarService.getAccount(wallet.stellar_public_key);
      console.log(`✅ Account found (sequence: ${account.sequenceNumber()})\n`);
    } catch (error) {
      console.log(`❌ Failed to fetch account: ${error instanceof Error ? error.message : error}\n`);
    }

    // Test 2: Fetch balances
    console.log('Test 2: Fetching on-chain balances...');
    try {
      const balances = await stellarService.getAccountBalances(wallet.stellar_public_key);
      console.log(`✅ Fetched ${Object.keys(balances).length} balances\n`);
      console.table(balances);
      console.log();
    } catch (error) {
      console.log(`❌ Failed to fetch balances: ${error instanceof Error ? error.message : error}\n`);
    }

    // Test 3: Check DB balances
    console.log('Test 3: Checking database balances...');
    const dbBalances = await WalletSyncService.getWalletBalancesFromDB(userId);
    console.log(`✅ Found ${Object.keys(dbBalances).length} assets in database\n`);
    console.table(dbBalances);
    console.log();

    // Test 4: Run sync
    console.log('Test 4: Running full sync...');
    const result = await WalletSyncService.syncWallet(userId, 'manual');
    if (result.hadDrift) {
      console.log(`⚠️  Drift detected: ${result.driftedAssets.join(', ')}\n`);
    } else {
      console.log('✅ All balances in sync\n');
    }

    // Test 5: Check drift history
    console.log('Test 5: Checking drift history...');
    const history = await WalletSyncService.getDriftHistory(userId, 5);
    if (history.length > 0) {
      console.log(`✅ Found ${history.length} recent drift events\n`);
    } else {
      console.log('✅ No recent drift events\n');
    }
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

/**
 * Show help
 */
function showHelp(): void {
  console.log(`
📋 Wallet Sync CLI Tool

Usage: npx ts-node scripts/wallet-sync-cli.ts [command] [options]

Commands:
  sync-user <userId>         Sync a single user's wallet
  sync-all [concurrency]     Sync all active wallets (default: 5 concurrent)
  audit-issues [limit]       Show unresolved drift issues (default: 20)
  resolve-issue <id> <action> [notes]
                             Resolve an issue (actions: confirmed_correct, corrected, ignored)
  stats [days]               Show statistics for last N days (default: 7)
  test <userId>              Run diagnostic test on a wallet
  help                       Show this help message

Examples:
  npx ts-node scripts/wallet-sync-cli.ts sync-user user-123
  npx ts-node scripts/wallet-sync-cli.ts sync-all 10
  npx ts-node scripts/wallet-sync-cli.ts audit-issues 50
  npx ts-node scripts/wallet-sync-cli.ts stats 30
  npx ts-node scripts/wallet-sync-cli.ts test user-456

  `);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    switch (command) {
      case 'sync-user':
        if (!args[1]) {
          console.error('❌ Usage: sync-user <userId>\n');
          process.exit(1);
        }
        await syncUser(args[1]);
        break;

      case 'sync-all':
        await syncAll({ concurrency: args[1] ? parseInt(args[1], 10) : undefined });
        break;

      case 'audit-issues':
        await auditIssues(args[1] ? parseInt(args[1], 10) : 20);
        break;

      case 'resolve-issue':
        if (!args[1] || !args[2]) {
          console.error('❌ Usage: resolve-issue <auditId> <action> [notes]\n');
          process.exit(1);
        }
        await resolveIssue(
          args[1],
          args[2] as 'confirmed_correct' | 'corrected' | 'ignored',
          args[3]
        );
        break;

      case 'stats':
        await showStats(args[1] ? parseInt(args[1], 10) : 7);
        break;

      case 'test':
        if (!args[1]) {
          console.error('❌ Usage: test <userId>\n');
          process.exit(1);
        }
        await testWallet(args[1]);
        break;

      case 'help':
        showHelp();
        break;

      default:
        console.error(`❌ Unknown command: ${command}\n`);
        showHelp();
        process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error(`❌ Fatal error: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

main().catch(console.error);
