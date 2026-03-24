import { runSeeds, resetDatabase, closePool, SeedSize } from '../../src/utils/seed-runner.utils';
import { seedUsers } from './users.seed';
import { seedMentorProfiles } from './mentors.seed';
import { seedSessions } from './sessions.seed';
import { seedReviews } from './reviews.seed';

const SEEDS = [seedUsers, seedMentorProfiles, seedSessions, seedReviews];

async function main() {
  const args = process.argv.slice(2);
  const shouldReset = args.includes('--reset');
  const sizeArg = args.find(a => a.startsWith('--size='))?.split('=')[1] as SeedSize | undefined;
  const size: SeedSize = sizeArg ?? (process.env.SEED_SIZE as SeedSize) ?? (process.env.NODE_ENV === 'test' ? 'test' : 'dev');

  console.log(`\n🌱 MentorsMind Seed Runner`);
  console.log(`   Mode: ${shouldReset ? 'reset + seed' : 'seed'} | Size: ${size}\n`);

  try {
    if (shouldReset) {
      console.log('🗑  Resetting database...');
      await resetDatabase();
    }

    await runSeeds(SEEDS, size);
    console.log('\n✅ Done.\n');
  } catch (err) {
    console.error('\n❌ Seeding failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
