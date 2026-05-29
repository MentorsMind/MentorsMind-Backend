import { logger } from '../utils/logger';
import pool from '../config/database';

interface BookmarkOptions {
  recordingId: string;
  userId: string;
  type?: 'bookmark' | 'annotation' | 'highlight';
  timestampSeconds: number;
  title?: string;
  note?: string;
  color?: string;
  durationSeconds?: number;
  isPrivate?: boolean;
}

interface Bookmark {
  id: string;
  recordingId: string;
  userId: string;
  type: string;
  timestampSeconds: number;
  title: string | null;
  note: string | null;
  color: string | null;
  durationSeconds: number | null;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Recording Bookmark Service - Handles bookmarks and annotations for recordings
 */
class RecordingBookmarkService {
  /**
   * Create a bookmark or annotation
   */
  async createBookmark(options: BookmarkOptions): Promise<Bookmark> {
    const {
      recordingId,
      userId,
      type = 'bookmark',
      timestampSeconds,
      title,
      note,
      color,
      durationSeconds,
      isPrivate = true,
    } = options;

    // Verify user has access to the recording
    const accessQuery = `
      SELECT id FROM session_recordings
      WHERE id = $1 AND (mentor_id = $2 OR mentee_id = $2)
    `;
    const { rows: accessRows } = await pool.query(accessQuery, [recordingId, userId]);
    
    if (accessRows.length === 0) {
      throw new Error('User does not have access to this recording');
    }

    const query = `
      INSERT INTO recording_bookmarks (
        recording_id, user_id, type, timestamp_seconds, title, note, color, duration_seconds, is_private
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const { rows } = await pool.query(query, [
      recordingId,
      userId,
      type,
      timestampSeconds,
      title || null,
      note || null,
      color || null,
      durationSeconds || null,
      isPrivate,
    ]);

    logger.info(`Created ${type} for recording ${recordingId} by user ${userId}`);
    return rows[0];
  }

  /**
   * Get bookmarks for a recording
   */
  async getBookmarksByRecording(recordingId: string, userId: string): Promise<Bookmark[]> {
    const query = `
      SELECT * FROM recording_bookmarks
      WHERE recording_id = $1
        AND (user_id = $2 OR is_private = false)
      ORDER BY timestamp_seconds ASC
    `;
    const { rows } = await pool.query(query, [recordingId, userId]);
    return rows;
  }

  /**
   * Get bookmarks by user
   */
  async getBookmarksByUser(userId: string): Promise<Bookmark[]> {
    const query = `
      SELECT rb.*, sr.session_id, sr.mentor_id, sr.mentee_id
      FROM recording_bookmarks rb
      JOIN session_recordings sr ON rb.recording_id = sr.id
      WHERE rb.user_id = $1
      ORDER BY rb.created_at DESC
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }

  /**
   * Get a specific bookmark
   */
  async getBookmark(bookmarkId: string, userId: string): Promise<Bookmark | null> {
    const query = `
      SELECT * FROM recording_bookmarks
      WHERE id = $1 AND user_id = $2
    `;
    const { rows } = await pool.query(query, [bookmarkId, userId]);
    return rows[0] || null;
  }

  /**
   * Update a bookmark
   */
  async updateBookmark(
    bookmarkId: string,
    userId: string,
    updates: Partial<BookmarkOptions>
  ): Promise<Bookmark> {
    const existing = await this.getBookmark(bookmarkId, userId);
    if (!existing) {
      throw new Error('Bookmark not found or user not authorized');
    }

    const updateFields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.title !== undefined) {
      updateFields.push(`title = $${idx}`);
      values.push(updates.title);
      idx++;
    }

    if (updates.note !== undefined) {
      updateFields.push(`note = $${idx}`);
      values.push(updates.note);
      idx++;
    }

    if (updates.color !== undefined) {
      updateFields.push(`color = $${idx}`);
      values.push(updates.color);
      idx++;
    }

    if (updates.isPrivate !== undefined) {
      updateFields.push(`is_private = $${idx}`);
      values.push(updates.isPrivate);
      idx++;
    }

    if (updateFields.length === 0) {
      return existing;
    }

    values.push(bookmarkId);

    const query = `
      UPDATE recording_bookmarks
      SET ${updateFields.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;

    const { rows } = await pool.query(query, values);
    logger.info(`Updated bookmark ${bookmarkId}`);
    return rows[0];
  }

  /**
   * Delete a bookmark
   */
  async deleteBookmark(bookmarkId: string, userId: string): Promise<void> {
    const query = `
      DELETE FROM recording_bookmarks
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `;
    const { rowCount } = await pool.query(query, [bookmarkId, userId]);
    
    if (rowCount === 0) {
      throw new Error('Bookmark not found or user not authorized');
    }

    logger.info(`Deleted bookmark ${bookmarkId}`);
  }

  /**
   * Get bookmarks near a timestamp
   */
  async getBookmarksNearTimestamp(
    recordingId: string,
    timestampSeconds: number,
    userId: string,
    windowSeconds: number = 30
  ): Promise<Bookmark[]> {
    const query = `
      SELECT * FROM recording_bookmarks
      WHERE recording_id = $1
        AND (user_id = $2 OR is_private = false)
        AND timestamp_seconds BETWEEN $3 AND $4
      ORDER BY timestamp_seconds ASC
    `;
    const { rows } = await pool.query(query, [
      recordingId,
      userId,
      timestampSeconds - windowSeconds,
      timestampSeconds + windowSeconds,
    ]);
    return rows;
  }

  /**
   * Export bookmarks for a recording
   */
  async exportBookmarks(recordingId: string, userId: string): Promise<any> {
    const bookmarks = await this.getBookmarksByRecording(recordingId, userId);
    
    return {
      recordingId,
      exportDate: new Date().toISOString(),
      bookmarks: bookmarks.map(b => ({
        timestamp: b.timestampSeconds,
        type: b.type,
        title: b.title,
        note: b.note,
        color: b.color,
        duration: b.durationSeconds,
      })),
    };
  }
}

export default new RecordingBookmarkService();
