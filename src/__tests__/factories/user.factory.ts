/**
 * User test factory.
 *
 * Creates rows in the `users` table and returns the persisted record.
 * Accepts a partial override object so callers can customise any field.
 */
import bcrypt from "bcryptjs";
import { faker } from "@faker-js/faker";
import { testPool } from "../setup/testDb";

export interface UserRecord {
  id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserOverrides {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: "user" | "mentor" | "admin";
  bio?: string | null;
  avatarUrl?: string | null;
  isActive?: boolean;
}

export async function createUser(
  overrides: UserOverrides = {},
): Promise<UserRecord> {
  const {
    email = faker.internet.email().toLowerCase(),
    password = "TestPassword123!",
    firstName = faker.person.firstName(),
    lastName = faker.person.lastName(),
    role = "user",
    bio = null,
    avatarUrl = null,
    isActive = true,
  } = overrides;

  // Use low bcrypt rounds for speed in tests
  const passwordHash = await bcrypt.hash(password, 4);

  const { rows } = await testPool.query<UserRecord>(
    `INSERT INTO users
       (email, password_hash, role, first_name, last_name, bio, avatar_url, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [email, passwordHash, role, firstName, lastName, bio, avatarUrl, isActive],
  );

  return rows[0];
}

export async function createMentorUser(
  overrides: UserOverrides = {},
): Promise<UserRecord> {
  return createUser({ ...overrides, role: "mentor" });
}

export async function createAdminUser(
  overrides: UserOverrides = {},
): Promise<UserRecord> {
  return createUser({ ...overrides, role: "admin" });
}

/** Bulk-create `count` users, each with a unique email. */
export async function createUsers(
  count: number,
  overrides: UserOverrides = {},
): Promise<UserRecord[]> {
  return Promise.all(
    Array.from({ length: count }, () => createUser(overrides)),
  );
}
