import { PoolClient } from 'pg';
import { SeedFn, SeedSize, seededRandom, pick } from '../../src/utils/seed-runner.utils';
import { seededBookings } from './sessions.seed';

const REVIEW_TITLES = [
  'Excellent mentor, highly recommend!',
  'Very knowledgeable and patient',
  'Great session, learned a lot',
  'Clear explanations and practical examples',
  'Helped me crack my interview',
  'Outstanding technical depth',
  'Very professional and punctual',
];

const REVIEW_COMMENTS = [
  'The session was incredibly insightful. My mentor explained complex concepts in a very clear and approachable way.',
  'I came in with a specific problem and left with a complete solution and a deeper understanding of the underlying principles.',
  'Fantastic experience. The mentor was well-prepared, patient, and gave me actionable feedback I could apply immediately.',
  'Really appreciated the real-world examples and the structured approach to problem-solving.',
  'One of the best mentoring sessions I have had. Will definitely book again.',
];

export const seedReviews: SeedFn = async (client: PoolClient, _size: SeedSize) => {
  const completedBookings = seededBookings.filter(b => b.status === 'completed');
  console.log(`  → Seeding reviews for ${completedBookings.length} completed sessions...`);

  let count = 0;
  for (const booking of completedBookings) {
    const rng = seededRandom(`review-${booking.id}`);
    const reviewId = `66666666-${booking.id.slice(9, 13)}-${booking.id.slice(14, 18)}-${booking.id.slice(19, 23)}-${String(count).padStart(12, '0')}`;
    const rating = 3 + Math.floor(rng() * 3); // 3–5 stars
    const subRating = () => Math.max(3, Math.min(5, rating + Math.floor(rng() * 3) - 1));

    await client.query(
      `INSERT INTO reviews (
        id, booking_id, reviewer_id, reviewee_id,
        rating, title, comment,
        communication_rating, professionalism_rating, knowledge_rating, punctuality_rating,
        is_published, helpful_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (booking_id, reviewer_id) DO NOTHING`,
      [
        reviewId,
        booking.id,
        booking.mentee_id,
        booking.mentor_id,
        rating,
        pick(REVIEW_TITLES, rng),
        pick(REVIEW_COMMENTS, rng),
        subRating(),
        subRating(),
        subRating(),
        subRating(),
        true,
        Math.floor(rng() * 15),
      ]
    );
    count++;
  }

  console.log(`  ✓ Seeded ${count} reviews`);
};
