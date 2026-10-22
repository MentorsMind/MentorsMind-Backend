import { CacheService } from './cache.service';
import { NotesService } from './notes.service';
import { SessionModel } from '../models/session.model';
import { OTOperation, OperationalTransform } from '../utils/operational-transform.utils';
import { logger } from '../utils/logger.utils';

export interface Participant {
  userId: string;
  role: 'mentor' | 'mentee' | 'viewer';
}

export interface CursorPosition {
  userId: string;
  lineNumber: number;
  column: number;
  position?: number;
}

export interface Annotation {
  id: string;
  userId: string;
  lineNumber: number;
  text: string;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  memoryUsed: number;
}

export interface CodeSession {
  sessionId: string;
  language: string;
  code: string;
  participants: Participant[];
  cursors: CursorPosition[];
  annotations: Annotation[];
  executionResults?: ExecutionResult[];
}

export class CodeCollaborationService {
  private static autosaveTimers = new Map<string, NodeJS.Timeout>();

  static async getDocument(sessionId: string): Promise<string> {
    const key = `collab:${sessionId}:document`;
    const doc = await CacheService.get<string>(key);
    return doc ?? '';
  }

  static async setDocument(sessionId: string, doc: string): Promise<void> {
    const key = `collab:${sessionId}:document`;
    await CacheService.set(key, doc, 86400); // 1 day TTL
  }

  static async getRevisions(sessionId: string): Promise<OTOperation[]> {
    const key = `collab:${sessionId}:revision`;
    const revs = await CacheService.get<OTOperation[]>(key);
    return revs ?? [];
  }

  static async setRevisions(sessionId: string, revs: OTOperation[]): Promise<void> {
    const key = `collab:${sessionId}:revision`;
    await CacheService.set(key, revs, 86400);
  }

  static async getUndoStack(sessionId: string, userId: string): Promise<OTOperation[]> {
    const key = `collab:${sessionId}:undo:${userId}`;
    const stack = await CacheService.get<OTOperation[]>(key);
    return stack ?? [];
  }

  static async setUndoStack(sessionId: string, userId: string, stack: OTOperation[]): Promise<void> {
    const key = `collab:${sessionId}:undo:${userId}`;
    await CacheService.set(key, stack.slice(-50), 86400); // Max 50 ops
  }

  static async getRedoStack(sessionId: string, userId: string): Promise<OTOperation[]> {
    const key = `collab:${sessionId}:redo:${userId}`;
    const stack = await CacheService.get<OTOperation[]>(key);
    return stack ?? [];
  }

  static async setRedoStack(sessionId: string, userId: string, stack: OTOperation[]): Promise<void> {
    const key = `collab:${sessionId}:redo:${userId}`;
    await CacheService.set(key, stack.slice(-50), 86400);
  }

  static async applyOperation(sessionId: string, op: OTOperation): Promise<OTOperation> {
    const doc = await this.getDocument(sessionId);
    const revs = await this.getRevisions(sessionId);

    // Transform op against any newer revisions
    let transformedOp = { ...op };
    if (op.baseVersion !== undefined && op.baseVersion < revs.length) {
      for (let i = op.baseVersion; i < revs.length; i++) {
        [transformedOp] = OperationalTransform.transform(transformedOp, revs[i]);
      }
    }

    const { newDoc, enrichedOp } = OperationalTransform.applyAndExtractDeleted(doc, transformedOp);
    await this.setDocument(sessionId, newDoc);

    enrichedOp.baseVersion = revs.length;
    revs.push(enrichedOp);
    await this.setRevisions(sessionId, revs);

    if (op.userId) {
      const undoStack = await this.getUndoStack(sessionId, op.userId);
      undoStack.push(enrichedOp);
      await this.setUndoStack(sessionId, op.userId, undoStack);
      // Clear redo stack on new operation
      await this.setRedoStack(sessionId, op.userId, []);
    }

    this.scheduleAutosave(sessionId);

    return enrichedOp;
  }

  static async undo(sessionId: string, userId: string): Promise<OTOperation | null> {
    const undoStack = await this.getUndoStack(sessionId, userId);
    if (undoStack.length === 0) return null;

    const opToUndo = undoStack.pop()!;
    let invertedOp = OperationalTransform.invert(opToUndo);
    invertedOp.userId = userId;

    const doc = await this.getDocument(sessionId);
    const revs = await this.getRevisions(sessionId);

    invertedOp.baseVersion = opToUndo.baseVersion! + 1; // It needs to be transformed against all ops after opToUndo

    if (invertedOp.baseVersion < revs.length) {
      for (let i = invertedOp.baseVersion; i < revs.length; i++) {
        [invertedOp] = OperationalTransform.transform(invertedOp, revs[i]);
      }
    }

    const { newDoc, enrichedOp } = OperationalTransform.applyAndExtractDeleted(doc, invertedOp);
    await this.setDocument(sessionId, newDoc);

    enrichedOp.baseVersion = revs.length;
    revs.push(enrichedOp);
    await this.setRevisions(sessionId, revs);

    await this.setUndoStack(sessionId, userId, undoStack);

    const redoStack = await this.getRedoStack(sessionId, userId);
    redoStack.push(opToUndo); // Push the original operation to redo stack
    await this.setRedoStack(sessionId, userId, redoStack);

    this.scheduleAutosave(sessionId);
    return enrichedOp;
  }

  static async redo(sessionId: string, userId: string): Promise<OTOperation | null> {
    const redoStack = await this.getRedoStack(sessionId, userId);
    if (redoStack.length === 0) return null;

    const opToRedo = redoStack.pop()!;
    let newOp: OTOperation = { ...opToRedo, userId, id: undefined, baseVersion: opToRedo.baseVersion }; // Clone

    const doc = await this.getDocument(sessionId);
    const revs = await this.getRevisions(sessionId);

    if (newOp.baseVersion !== undefined && newOp.baseVersion < revs.length) {
      for (let i = newOp.baseVersion; i < revs.length; i++) {
        [newOp] = OperationalTransform.transform(newOp, revs[i]);
      }
    }

    const { newDoc, enrichedOp } = OperationalTransform.applyAndExtractDeleted(doc, newOp);
    await this.setDocument(sessionId, newDoc);

    enrichedOp.baseVersion = revs.length;
    revs.push(enrichedOp);
    await this.setRevisions(sessionId, revs);

    await this.setRedoStack(sessionId, userId, redoStack);

    const undoStack = await this.getUndoStack(sessionId, userId);
    undoStack.push(enrichedOp);
    await this.setUndoStack(sessionId, userId, undoStack);

    this.scheduleAutosave(sessionId);
    return enrichedOp;
  }

  static scheduleAutosave(sessionId: string) {
    if (this.autosaveTimers.has(sessionId)) return;

    const timer = setInterval(async () => {
      await this.performAutosave(sessionId);
    }, 60000); // 60s
    this.autosaveTimers.set(sessionId, timer);
  }

  static async performAutosave(sessionId: string) {
    try {
      const doc = await this.getDocument(sessionId);
      const session = await SessionModel.findById(sessionId);
      if (session && session.mentee_id) {
        const notes = await NotesService.getNotesBySession(sessionId, session.mentee_id);
        const codeNote = notes.find(n => n.content.startsWith('--- Code Session Autosave ---'));
        const content = `--- Code Session Autosave ---\n\n${doc}`;

        if (codeNote) {
          await NotesService.updateNote(codeNote.id, session.mentee_id, content);
        } else {
          await NotesService.createNote(sessionId, session.mentee_id, content);
        }
        logger.info(`Autosaved code for session ${sessionId}`);
      }
    } catch (err: any) {
      logger.error(`Autosave failed for session ${sessionId}: ${err.message}`);
    }
  }

  static destroySession(sessionId: string) {
    const timer = this.autosaveTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.autosaveTimers.delete(sessionId);
    }
  }
}
