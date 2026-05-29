/**
 * Mentor test factory.
 *
 * Creates a user row with role='mentor'.  The `users` table is the source of
 * truth for mentor identity; this factory adds mentor-flavoured defaults on
 * top of the base user factory.
 */
import { faker } from "@faker-js/faker";
import { createUser, UserRecord } from "./user.factory";

export interface MentorOverrides {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  isActive?: boolean;
}

export async function createMentor(
  overrides: MentorOverrides = {},
): Promise<UserRecord> {
  return createUser({
    email: overrides.email ?? faker.internet.email().toLowerCase(),
    password: overrides.password,
    firstName: overrides.firstName ?? faker.person.firstName(),
    lastName: overrides.lastName ?? faker.person.lastName(),
    role: "mentor",
    bio:
      overrides.bio !== undefined
        ? overrides.bio
        : faker.lorem.sentence({ min: 8, max: 20 }),
    avatarUrl:
      overrides.avatarUrl !== undefined
        ? overrides.avatarUrl
        : faker.image.avatar(),
    isActive: overrides.isActive ?? true,
  });
}

/** Bulk-create `count` mentor users. */
export async function createMentors(
  count: number,
  overrides: MentorOverrides = {},
): Promise<UserRecord[]> {
  return Promise.all(
    Array.from({ length: count }, () => createMentor(overrides)),
  );
}
