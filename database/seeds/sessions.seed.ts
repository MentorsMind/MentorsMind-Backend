import { PoolClient } from 'pg';
import { SeedFn, SeedSize, SEED_SIZES, seededRandom, pick, daysAgo, daysFromNow } from '../../src/utils/seed-runner.utils';
import { seededUsers } from './users.seed';

const SESSION_TITLES = [
  'React Performance Optimization', 'System Design Interview Prep',
  'Python for Data Science', 'AWS Architecture Review',
  'Career Guidance & Resume Review', 'Code Review & Best Practices',
  'Machine Learning Fundamentals', 'TypeScript Deep Dive',
  'Docker & Kubernetes Intro', 'GraphQL API Design',
];

const SESSION_TYPES = ['video_call', 'audio_call', 'chat'];
const DURATIONS = [30, 45, 60, 90];

// Exported so reviews seed can reference completed bookings
export interface SeededBooking {
  id: string;
  mentor_id: string;
  mentee_id: string;
  status: string;
  amount: number;
  mentor_wallet_id?: string;
  mentee_wallet_id?: string;
}

export const seededBookings: SeededBooking[] = [];

export const seedSessions: SeedFn = async (client: PoolClient, size: SeedSize) => {
  seededBookings.length = 0;
  const { sessionsPerMentor } = SEED_SIZES[size];
  const mentors = seededUsers.filter(u => u.role === 'mentor');
  const mentees = seededUsers.filter(u => u.role === 'mentee');

  if (!mentors.length || !mentees.length) throw new Error('No mentors/mentees found — run users seed first');

  console.log(`  → Seeding sessions (${sessionsPerMentor} per mentor)...`);

  let txCount = 0;
  let bookingCount = 0;

  for (const mentor of mentors) {
    for (let i = 0; i < sessionsPerMentor; i++) {
      const rng = seededRandom(`session-${mentor.id}-${i}`);
      const mentee = pick(mentees, rng);
      const bookingId = `44444444-${mentor.id.slice(9, 13)}-${String(i).padStart(4, '0')}-${mentee.id.slice(19, 23)}-${String(bookingCount).padStart(12, '0')}`;
      const txId = `55555555-${mentor.id.slice(9, 13)}-${String(i).padStart(4, '0')}-${mentee.id.slice(19, 23)}-${String(txCount).padStart(12, '0')}`;

      const durationMins = pick(DURATIONS, rng);
      const hourlyRate = 50 + Math.floor(seededRandom(`rate-${mentor.id}`)() * 100);
      const amount = parseFloat(((hourlyRate / 60) * durationMins).toFixed(2));
      const platformFee = parseFloat((amount * 0.05).toFixed(2));
      const mentorPayout = parseFloat((amount - platformFee).toFixed(2));
      const title = pick(SESSION_TITLES, rng);
      const sessionType = pick(SESSION_TYPES, rng);

      // Alternate between past (completed) and future (upcoming) sessions
      const isPast = i < Math.ceil(sessionsPerMentor / 2);
      const offsetDays = isPast ? -(i + 1) * 7 : (i + 1) * 3;
      const startTime = isPast ? daysAgo((i + 1) * 7) : daysFromNow((i + 1) * 3);
      const endTime = new Date(startTime.getTime() + durationMins * 60 * 1000);

      const bookingStatus = isPast ? 'completed' : 'confirmed';
      const paymentStatus = isPast ? 'released' : 'held_in_escrow';

      // Seed the payment transaction first
      const stellarHash = `${seededRandom(`hash-${txId}`)().toString(36).slice(2).padEnd(32, '0')}${seededRandom(`hash2-${txId}`)().toString(36).slice(2).padEnd(32, '0')}`.slice(0, 64).toUpperCase();

      await client.query(
        `INSERT INTO transactions (
          id, user_id, type, status, amount, currency,
          stellar_tx_hash, from_address, to_address,
          platform_fee, network_fee,
          initiated_at, completed_at, description
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO NOTHING`,
        [
          txId,
          mentee.id,
          'payment',
          isPast ? 'completed' : 'processing',
          amount,
          'XLM',
          stellarHash,
          mentee.stellar_public_key,
          mentor.stellar_public_key,
          platformFee,
          0.00001,
          startTime,
          isPast ? endTime : null,
          `Payment for: ${title}`,
        ]
      );
      txCount++;

      // Seed the booking
      await client.query(
        `INSERT INTO bookings (
          id, mentee_id, mentor_id, title, session_type,
          scheduled_start, scheduled_end, timezone,
          actual_start, actual_end,
          status, payment_status,
          amount, currency, platform_fee, mentor_payout,
          payment_transaction_id,
          completed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (id) DO NOTHING`,
        [
          bookingId,
          mentee.id,
          mentor.id,
          title,
          sessionType,
          startTime,
          endTime,
          'UTC',
          isPast ? startTime : null,
          isPast ? endTime : null,
          bookingStatus,
          paymentStatus,
          amount,
          'XLM',
          platformFee,
          mentorPayout,
          txId,
          isPast ? endTime : null,
        ]
      );

      seededBookings.push({
        id: bookingId,
        mentor_id: mentor.id,
        mentee_id: mentee.id,
        status: bookingStatus,
        amount,
      });
      bookingCount++;
    }
  }

  console.log(`  ✓ Seeded ${bookingCount} bookings and ${txCount} transactions`);
};
