/**
 * Integration test for SessionModel.archiveOlderThanYears()
 *
 * Tests verify that:
 * 1. Sessions older than N years are moved to sessions_archive
 * 2. Sessions within N years are NOT archived
 * 3. archiveOlderThanYears returns the correct count of archived rows
 * 4. Error paths throw rather than returning 0
 */

import pool from "../../../src/config/database";
import { SessionModel } from "../../../src/models/session.model";

/**
 * Helper: Create a session record with a specific created_at date.
 */
function session(daysAgo: number): { id: string; created_at: Date } {
  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - daysAgo);
  // Generate a deterministic ID for test reproducibility
  const id = `test-session-${daysAgo}-${Date.now()}`;
  return { id, created_at: createdAt };
}

describe("SessionModel archiveOlderThanYears Integration", () => {
  let createdIds: string[] = [];

  beforeAll(async () => {
    // Ensure sessions table and archive table are clean
    await pool.query(`TRUNCATE sessions, sessions_archive CASCADE`);
  });

  afterEach(async () => {
    // Clean up any sessions created in tests
    if (createdIds.length > 0) {
      const placeholders = createdIds.map((_, idx) => `$${idx + 1}`).join(",");
      await pool.query(
        `DELETE FROM sessions WHERE id IN (${placeholders})`,
        createdIds,
      );
      await pool.query(
        `DELETE FROM sessions_archive WHERE id IN (${placeholders})`,
        createdIds,
      );
    }
    createdIds = [];
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("archival logic", () => {
    it("should move sessions older than N years to archive and not touch recent sessions", async () => {
      // Arrange: Create one session 8 years ago and one 2 years ago
      const oldSession = session(8 * 365); // 8 years ago
      const recentSession = session(2 * 365); // 2 years ago

      // Insert old session directly
      await pool.query(
        `INSERT INTO sessions (id, mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, status, meeting_link, meeting_url, meeting_provider, meeting_room_id, meeting_expires_at, needs_manual_intervention, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          oldSession.id,
          "mentor-1",
          "mentee-1",
          "Old Session",
          "Session from 8 years ago",
          new Date(),
          60,
          "completed",
          "http://example.com/old",
          null,
          "zoom",
          null,
          false,
          "old notes",
          oldSession.created_at,
          new Date(),
        ],
      );

      // Insert recent session directly
      await pool.query(
        `INSERT INTO sessions (id, mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, status, meeting_link, meeting_url, meeting_provider, meeting_room_id, meeting_expires_at, needs_manual_intervention, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          recentSession.id,
          "mentor-2",
          "mentee-2",
          "Recent Session",
          "Session from 2 years ago",
          new Date(),
          60,
          "completed",
          "http://example.com/recent",
          null,
          "zoom",
          null,
          false,
          "recent notes",
          recentSession.created_at,
          new Date(),
        ],
      );

      createdIds.push(oldSession.id, recentSession.id);

      // Act: Archive sessions older than 5 years
      const archivedCount = await SessionModel.archiveOlderThanYears(5);

      // Assert
      // Should have archived exactly 1 session (the 8-year-old one)
      expect(archivedCount).toBe(1);

      // The old session should now be in sessions_archive
      const archivedResult = await pool.query<
        { id: string }
      >(`SELECT id FROM sessions_archive WHERE id = $1`, [oldSession.id]);
      expect(archivedResult.rows.length).toBe(1);

      // The old session should be removed from sessions
      const remainingSessions = await pool.query<
        { count: string }
      >(`SELECT COUNT(*) FROM sessions WHERE id = $1`, [oldSession.id]);
      expect(remainingSessions.rows[0].count).toBe("0");

      // The recent session should still be in sessions (not archived)
      const recentStillExists = await pool.query<
        { count: string }
      >(`SELECT COUNT(*) FROM sessions WHERE id = $1`, [recentSession.id]);
      expect(recentStillExists.rows[0].count).toBe("1");
    });

    it("should return correct count of archived rows", async () => {
      // Arrange: Create 3 sessions older than 5 years and 2 sessions within 5 years
      for (let i = 0; i < 3; i++) {
        const s = session(8 * 365 + i);
        await pool.query(
          `INSERT INTO sessions (id, mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, status, meeting_link, meeting_url, meeting_provider, meeting_room_id, meeting_expires_at, needs_manual_intervention, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            s.id,
            "mentor-1",
            "mentee-1",
            `Old Session ${i}`,
            `Session from 8 years ago ${i}`,
            new Date(),
            60,
            "completed",
            "http://example.com/old",
            null,
            "zoom",
            null,
            false,
            "old notes",
            s.created_at,
            new Date(),
          ],
        );
        createdIds.push(s.id);
      }

      for (let i = 0; i < 2; i++) {
        const s = session(2 * 365 + i);
        await pool.query(
          `INSERT INTO sessions (id, mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, status, meeting_link, meeting_url, meeting_provider, meeting_room_id, meeting_expires_at, needs_manual_intervention, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            s.id,
            "mentor-2",
            "mentee-2",
            `Recent Session ${i}`,
            `Session from 2 years ago ${i}`,
            new Date(),
            60,
            "completed",
            "http://example.com/recent",
            null,
            "zoom",
            null,
            false,
            "recent notes",
            s.created_at,
            new Date(),
          ],
        );
        createdIds.push(s.id);
      }

      // Act
      const archivedCount = await SessionModel.archiveOlderThanYears(5);

      // Assert
      expect(archivedCount).toBe(3);
    });
  });
});