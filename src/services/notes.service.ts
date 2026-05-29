/**
 * Session Notes Service - Business logic for learner's private session notes
 */

import pool from '../config/database';
import { logger } from '../utils/logger.utils';
import { SessionModel } from '../models/session.model';

export interface SessionNoteRecord {
    id: string;
    session_id: string;
    learner_id: string;
    content: string;
    created_at: Date;
    updated_at: Date;
}

export const NotesService = {
    /**
     * Create a new note for a session
     * Verifies that the session belongs to the learner
     */
    async createNote(sessionId: string, learnerId: string, content: string): Promise<SessionNoteRecord> {
        // Verify session existence and ownership
        const session = await SessionModel.findById(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        if (session.mentee_id !== learnerId) {
            logger.warn('[NotesService] Unauthorized attempt to create note', { sessionId, learnerId });
            throw new Error('Unauthorized: Notes can only be created by the session mentee');
        }

        if (content.length > 10000) {
            throw new Error('Note content exceeds maximum length of 10,000 characters');
        }

        const { rows } = await pool.query<SessionNoteRecord>(
            `INSERT INTO session_notes (session_id, learner_id, content)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [sessionId, learnerId, content]
        );

        logger.info('[NotesService] Note created', { noteId: rows[0].id, sessionId, learnerId });
        return rows[0];
    },

    /**
     * Get all notes for a specific session
     * Sorted by updated_at descending
     */
    async getNotesBySession(sessionId: string, learnerId: string): Promise<SessionNoteRecord[]> {
        const { rows } = await pool.query<SessionNoteRecord>(
            `SELECT * FROM session_notes
             WHERE session_id = $1 AND learner_id = $2
             ORDER BY updated_at DESC`,
            [sessionId, learnerId]
        );

        return rows;
    },

    /**
     * Update an existing note
     * Verifies ownership before updating
     */
    async updateNote(noteId: string, learnerId: string, content: string): Promise<SessionNoteRecord> {
        if (content.length > 10000) {
            throw new Error('Note content exceeds maximum length of 10,000 characters');
        }

        const { rows } = await pool.query<SessionNoteRecord>(
            `UPDATE session_notes
             SET content = $1, updated_at = NOW()
             WHERE id = $2 AND learner_id = $3
             RETURNING *`,
            [content, noteId, learnerId]
        );

        if (rows.length === 0) {
            throw new Error('Note not found or unauthorized');
        }

        logger.info('[NotesService] Note updated', { noteId, learnerId });
        return rows[0];
    },

    /**
     * Delete a note
     * Verifies ownership before deleting
     */
    async deleteNote(noteId: string, learnerId: string): Promise<void> {
        const { rowCount } = await pool.query(
            `DELETE FROM session_notes WHERE id = $1 AND learner_id = $2`,
            [noteId, learnerId]
        );

        if (rowCount === 0) {
            throw new Error('Note not found or unauthorized');
        }

        logger.info('[NotesService] Note deleted', { noteId, learnerId });
    },

    /**
     * Full-text search across learner's notes
     * Sorted by updated_at descending
     */
    async searchNotes(learnerId: string, query: string): Promise<SessionNoteRecord[]> {
        // Use plainto_tsquery for simple search terms or just tsquery for more complex ones
        // Here we use plainto_tsquery to make it user-friendly
        const { rows } = await pool.query<SessionNoteRecord>(
            `SELECT * FROM session_notes
             WHERE learner_id = $1
               AND to_tsvector('english', content) @@ plainto_tsquery('english', $2)
             ORDER BY updated_at DESC`,
            [learnerId, query]
        );

        return rows;
    }
};
