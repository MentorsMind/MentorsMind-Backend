import { PoolClient } from 'pg';
import { SeedFn, SeedSize, SEED_SIZES, seededRandom, pick, pickN } from '../../src/utils/seed-runner.utils';

// Pre-hashed bcrypt of 'Password123!' (rounds=10) — deterministic
const PASSWORD_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LpMSurdKm.e';

const SKILLS = [
  'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Machine Learning',
  'Data Science', 'AWS', 'System Design', 'UI/UX Design', 'Figma', 'DevOps',
  'Docker', 'Kubernetes', 'GraphQL', 'PostgreSQL', 'MongoDB', 'Go', 'Rust',
  'iOS Development', 'Android Development', 'Blockchain', 'Solidity', 'TensorFlow',
];

const TIMEZONES = [
  'America/New_York', 'America/Los_Angeles', 'America/Chicago',
  'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore',
];

const MENTOR_BIOS = [
  'Senior engineer with 10+ years building scalable systems. Love helping developers level up their skills.',
  'Data scientist and ML engineer passionate about teaching Python and machine learning fundamentals.',
  'Full-stack developer specializing in React and Node.js. Helped 200+ developers land their first job.',
  'Cloud architect with deep AWS expertise. Focused on system design and distributed systems.',
  'UX/UI designer with a focus on user research and design systems. Mentor to aspiring designers.',
];

/** Generates a valid-format Stellar public key (G + 55 base32 chars) */
function stellarKey(seed: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const rng = seededRandom(seed);
  return 'G' + Array.from({ length: 55 }, () => chars[Math.floor(rng() * chars.length)]).join('');
}

export interface SeededUser {
  id: string;
  role: 'mentor' | 'mentee' | 'admin';
  stellar_public_key: string;
}

// Store seeded users so other seeds can reference them
export const seededUsers: SeededUser[] = [];

export const seedUsers: SeedFn = async (client: PoolClient, size: SeedSize) => {
  seededUsers.length = 0;
  const { mentors, mentees } = SEED_SIZES[size];
  console.log(`  → Seeding users (${mentors} mentors, ${mentees} mentees)...`);

  // Admin
  const adminId = '00000000-0000-0000-0000-000000000001';
  await client.query(
    `INSERT INTO users (id, email, password_hash, username, full_name, role, status, email_verified, stellar_public_key, stellar_account_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [adminId, 'admin@mentorsmind.com', PASSWORD_HASH, 'admin', 'Platform Admin', 'admin', 'active', true, stellarKey('admin-key'), true]
  );
  seededUsers.push({ id: adminId, role: 'admin', stellar_public_key: stellarKey('admin-key') });

  // Mentors
  for (let i = 0; i < mentors; i++) {
    const rng = seededRandom(`mentor-${i}`);
    const id = `11111111-1111-1111-1111-${String(i + 1).padStart(12, '0')}`;
    const skills = pickN(SKILLS, 4 + Math.floor(rng() * 3), rng);
    const key = stellarKey(`mentor-stellar-${i}`);

    await client.query(
      `INSERT INTO users (
        id, email, password_hash, username, full_name, role, status,
        bio, hourly_rate, expertise, years_of_experience, is_available,
        email_verified, stellar_public_key, stellar_account_verified,
        average_rating, total_reviews, total_sessions_completed, timezone
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (id) DO NOTHING`,
      [
        id,
        `mentor${i + 1}@mentorsmind.dev`,
        PASSWORD_HASH,
        `mentor_${i + 1}`,
        `Mentor User ${i + 1}`,
        'mentor',
        'active',
        MENTOR_BIOS[i % MENTOR_BIOS.length],
        50 + Math.floor(seededRandom(`rate-${i}`)() * 100),
        skills,
        3 + Math.floor(rng() * 12),
        true,
        true,
        key,
        true,
        (3.5 + seededRandom(`rating-${i}`)() * 1.5).toFixed(2),
        Math.floor(seededRandom(`reviews-${i}`)() * 80) + 5,
        Math.floor(seededRandom(`sessions-${i}`)() * 150) + 10,
        pick(TIMEZONES, rng),
      ]
    );
    seededUsers.push({ id, role: 'mentor', stellar_public_key: key });
  }

  // Mentees
  for (let i = 0; i < mentees; i++) {
    const rng = seededRandom(`mentee-${i}`);
    const id = `22222222-2222-2222-2222-${String(i + 1).padStart(12, '0')}`;
    const key = stellarKey(`mentee-stellar-${i}`);

    await client.query(
      `INSERT INTO users (
        id, email, password_hash, username, full_name, role, status,
        email_verified, stellar_public_key, stellar_account_verified, timezone
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO NOTHING`,
      [
        id,
        `mentee${i + 1}@mentorsmind.dev`,
        PASSWORD_HASH,
        `mentee_${i + 1}`,
        `Mentee User ${i + 1}`,
        'mentee',
        'active',
        true,
        key,
        true,
        pick(TIMEZONES, rng),
      ]
    );
    seededUsers.push({ id, role: 'mentee', stellar_public_key: key });
  }

  console.log(`  ✓ Seeded ${seededUsers.length} users`);
};
