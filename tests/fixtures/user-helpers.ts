/**
 * tests/fixtures/user-helpers.ts
 *
 * Helper functions for creating test users (mentors, mentees, admins)
 * and issuing JWT tokens for E2E and integration tests.
 */

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { TokenService } from '../../src/services/token.service';

export interface CreateTestUserOptions {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: 'admin' | 'mentor' | 'mentee';
  userTier?: 'free' | 'pro' | 'enterprise';
  hourlyRate?: number;
  bio?: string;
  expertise?: string[];
  yearsOfExperience?: number;
  walletPublicKey?: string;
  isActive?: boolean;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: 'admin' | 'mentor' | 'mentee';
  firstName: string;
  lastName: string;
  hourlyRate: number | null;
  walletPublicKey: string;
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

export const DEFAULT_NOTIFICATION_PREFERENCES = JSON.stringify({
  booking_confirmed: { email: true, push: false, in_app: true },
  payment_processed: { email: true, push: false, in_app: true },
  session_reminder: { email: true, push: false, in_app: true },
  dispute_created: { email: true, push: false, in_app: true },
  system_alert: { email: true, push: false, in_app: true },
  meeting_confirmed: { email: true, push: false, in_app: true },
  message_received: { email: false, push: false, in_app: true },
  session_cancelled: { email: true, push: false, in_app: true },
});

/**
 * Generate JWT access and refresh tokens for any user record
 */
export async function issueUserTokens(user: {
  id: string;
  email: string;
  role: string;
  user_tier?: string;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const tokens = await TokenService.issueTokens(
    user.id,
    user.email,
    user.role,
    user.user_tier || 'free',
    undefined,
    { deviceName: 'e2e-test', ipAddress: '127.0.0.1' },
  );
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

/**
 * Create a new test user in the database with hashed password, wallet, and JWT tokens.
 */
export async function createTestUser(
  pool: Pool,
  options: CreateTestUserOptions = {},
): Promise<TestUser> {
  const salt = await bcrypt.genSalt(10);
  const id = uuidv4();
  const role = options.role ?? 'mentee';
  const email = options.email ?? `${role}-${id.slice(0, 8)}@test.com`;
  const password = options.password ?? 'TestPass123!';
  const firstName = options.firstName ?? (role === 'mentor' ? 'Test' : 'Test');
  const lastName = options.lastName ?? (role === 'mentor' ? 'Mentor' : 'Mentee');
  const userTier = options.userTier ?? (role === 'mentor' ? 'pro' : 'free');
  const hourlyRate = role === 'mentor' ? (options.hourlyRate ?? 50.0) : null;
  const bio = options.bio ?? (role === 'mentor' ? 'Experienced software mentor' : null);
  const expertise = options.expertise ?? (role === 'mentor' ? ['TypeScript', 'Stellar', 'Smart Contracts'] : null);
  const yearsOfExperience = options.yearsOfExperience ?? (role === 'mentor' ? 5 : null);
  const isActive = options.isActive ?? true;

  const passwordHash = await bcrypt.hash(password, salt);

  // Insert user
  await pool.query(
    `INSERT INTO users (
      id, email, password_hash, first_name, last_name, role,
      notification_preferences, user_tier, is_active,
      hourly_rate, bio, expertise, years_of_experience
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      email,
      passwordHash,
      firstName,
      lastName,
      role,
      DEFAULT_NOTIFICATION_PREFERENCES,
      userTier,
      isActive,
      hourlyRate,
      bio,
      expertise,
      yearsOfExperience,
    ],
  );

  // Random deterministic-format 56-char Stellar public key
  const walletPublicKey =
    options.walletPublicKey ??
    `G${role.toUpperCase().padEnd(6, 'X')}${uuidv4().replace(/-/g, '').toUpperCase().slice(0, 48)}`;

  // Insert wallet
  await pool.query(
    `INSERT INTO wallets (id, user_id, stellar_public_key, balance, currency, is_active)
     VALUES ($1, $2, $3, 1000, 'XLM', true)`,
    [uuidv4(), id, walletPublicKey],
  );

  // Generate tokens
  const tokens = await issueUserTokens({
    id,
    email,
    role,
    user_tier: userTier,
  });

  return {
    id,
    email,
    password,
    role,
    firstName,
    lastName,
    hourlyRate,
    walletPublicKey,
    tokens,
  };
}

/**
 * Convenience helper: create a mentor with hourlyRate and skills
 */
export async function createTestMentor(
  pool: Pool,
  overrides: Partial<CreateTestUserOptions> = {},
): Promise<TestUser> {
  return createTestUser(pool, {
    role: 'mentor',
    hourlyRate: 50.0,
    bio: 'Senior Stellar & Backend Engineer',
    expertise: ['TypeScript', 'Stellar', 'Soroban', 'Node.js'],
    yearsOfExperience: 7,
    ...overrides,
  });
}

/**
 * Convenience helper: create a mentee
 */
export async function createTestMentee(
  pool: Pool,
  overrides: Partial<CreateTestUserOptions> = {},
): Promise<TestUser> {
  return createTestUser(pool, {
    role: 'mentee',
    ...overrides,
  });
}
