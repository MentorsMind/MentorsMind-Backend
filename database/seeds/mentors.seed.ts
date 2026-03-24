import { PoolClient } from 'pg';
import { SeedFn, SeedSize, seededRandom } from '../../src/utils/seed-runner.utils';
import { seededUsers } from './users.seed';

/** Seed wallets for all users (mentors get higher balances) */
export const seedMentorProfiles: SeedFn = async (client: PoolClient, _size: SeedSize) => {
  console.log('  → Seeding wallets & mentor profiles...');

  let count = 0;
  for (const user of seededUsers) {
    const rng = seededRandom(`wallet-${user.id}`);
    const walletId = `33333333-${user.id.slice(9, 13)}-${user.id.slice(14, 18)}-${user.id.slice(19, 23)}-${user.id.slice(24)}`;
    const balance = user.role === 'mentor'
      ? (100 + rng() * 900).toFixed(7)
      : (10 + rng() * 200).toFixed(7);

    await client.query(
      `INSERT INTO wallets (
        id, user_id, stellar_public_key, stellar_account_id,
        wallet_type, status, native_balance, last_balance_update
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (stellar_public_key) DO NOTHING`,
      [walletId, user.id, user.stellar_public_key, user.stellar_public_key, 'user', 'active', balance]
    );

    // Add XLM balance entry
    await client.query(
      `INSERT INTO wallet_balances (wallet_id, asset_type, balance, last_updated)
       VALUES ($1, 'native', $2, NOW())
       ON CONFLICT DO NOTHING`,
      [walletId, balance]
    );

    count++;
  }

  console.log(`  ✓ Seeded ${count} wallets`);
};
