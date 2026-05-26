/**
 * Session Notes Controller - Handles HTTP requests for learner's private notes
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { NotesService } from '../services/notes.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

export const NotesController = {
    /**
     * POST /sessions/:id/notes
     * Create a note for a session
     */
    createNote: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const sessionId = req.params.id;
        const learnerId = req.user!.id;
        const { content } = req.body;

        if (!content) {
            return ResponseUtil.error(res, 'Note content is required', 400);
        }

        try {
            const note = await NotesService.createNote(sessionId, learnerId, content);
            return ResponseUtil.created(res, note, 'Note created successfully');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create note';
            const status = message.includes('Unauthorized') ? 403 : (message.includes('not found') ? 404 : 400);
            return ResponseUtil.error(res, message, status);
        }
    }),

    /**
     * GET /sessions/:id/notes
     * Get all notes for a session
     */
    getNotesBySession: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const sessionId = req.params.id;
        const learnerId = req.user!.id;

        const notes = await NotesService.getNotesBySession(sessionId, learnerId);
        return ResponseUtil.success(res, notes, 'Notes retrieved successfully');
    }),

    /**
     * PUT /notes/:id
     * Update an existing note
     */
    updateNote: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const noteId = req.params.id;
        const learnerId = req.user!.id;
        const { content } = req.body;

        if (!content) {
            return ResponseUtil.error(res, 'Note content is required', 400);
        }

        try {
            const note = await NotesService.updateNote(noteId, learnerId, content);
            return ResponseUtil.success(res, note, 'Note updated successfully');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update note';
            const status = message.includes('unauthorized') ? 403 : (message.includes('not found') ? 404 : 400);
            return ResponseUtil.error(res, message, status);
        }
    }),

    /**
     * DELETE /notes/:id
     * Delete a note
     */
    deleteNote: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const noteId = req.params.id;
        const learnerId = req.user!.id;

        try {
            await NotesService.deleteNote(noteId, learnerId);
            return ResponseUtil.noContent(res);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete note';
            const status = message.includes('unauthorized') ? 403 : (message.includes('not found') ? 404 : 400);
            return ResponseUtil.error(res, message, status);
        }
    }),

    /**
     * GET /notes/search?q=...
     * Full-text search across learner's notes
     */
    searchNotes: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
        const learnerId = req.user!.id;
        const query = req.query.q as string;

        if (!query) {
            return ResponseUtil.error(res, 'Search query (q) is required', 400);
        }

        const notes = await NotesService.searchNotes(learnerId, query);
        return ResponseUtil.success(res, notes, 'Search results retrieved successfully');
    })
};
