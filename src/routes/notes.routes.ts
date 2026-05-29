/**
 * Session Notes Routes - Learner's private session notes API
 */

import { Router } from 'express';
import { NotesController } from '../controllers/notes.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import { idParamSchema } from '../validators/schemas/common.schemas';
import { body } from 'express-validator';

const router = Router();

// All note routes require authentication and mentee (learner) role
router.use(authenticate);
router.use(requireRole('mentee'));

/**
 * @swagger
 * tags:
 *   name: Notes
 *   description: Private learner notes for sessions
 */

/**
 * @swagger
 * /sessions/{id}/notes:
 *   post:
 *     summary: Create a note for a session
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Session ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, maxLength: 10000 }
 *     responses:
 *       201: { description: Note created }
 */
router.post(
    '/sessions/:id/notes',
    validate(idParamSchema),
    [body('content').isString().isLength({ max: 10000 }).withMessage('Content max 10,000 chars')],
    NotesController.createNote
);

/**
 * @swagger
 * /sessions/{id}/notes:
 *   get:
 *     summary: Get all notes for a session
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Session ID
 *     responses:
 *       200: { description: List of notes }
 */
router.get(
    '/sessions/:id/notes',
    validate(idParamSchema),
    NotesController.getNotesBySession
);

/**
 * @swagger
 * /notes/search:
 *   get:
 *     summary: Search across all notes
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Search query
 *     responses:
 *       200: { description: Search results }
 */
router.get(
    '/notes/search',
    NotesController.searchNotes
);

/**
 * @swagger
 * /notes/{id}:
 *   put:
 *     summary: Update an existing note
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Note ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, maxLength: 10000 }
 *     responses:
 *       200: { description: Note updated }
 */
router.put(
    '/notes/:id',
    validate(idParamSchema),
    [body('content').isString().isLength({ max: 10000 }).withMessage('Content max 10,000 chars')],
    NotesController.updateNote
);

/**
 * @swagger
 * /notes/{id}:
 *   delete:
 *     summary: Delete a note
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Note ID
 *     responses:
 *       204: { description: Note deleted }
 */
router.delete(
    '/notes/:id',
    validate(idParamSchema),
    NotesController.deleteNote
);

export default router;
