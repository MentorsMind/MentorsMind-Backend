import { CursorPayload } from '../types/pagination.types';

/**
 * Pagination Utilities
 */
export const PaginationUtil = {
  /**
   * Encode cursor payload to base64 string
   */
  encodeCursor(payload: CursorPayload): string {
    const json = JSON.stringify(payload);
    return Buffer.from(json).toString('base64');
  },

  /**
   * Decode base64 cursor string to payload
   */
  decodeCursor(cursor: string): CursorPayload | null {
    try {
      const json = Buffer.from(cursor, 'base64').toString('utf8');
      const payload = JSON.parse(json) as CursorPayload;
      if (!payload.id || !payload.created_at) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  },

  /**
   * Helper to extract the last item's cursor payload from a result set
   */
  getCursorFromItem(item: any): CursorPayload | null {
    if (!item) return null;
    return {
      id: item.id,
      created_at: item.created_at instanceof Date ? item.created_at.toISOString() : item.created_at,
    };
  },
};
