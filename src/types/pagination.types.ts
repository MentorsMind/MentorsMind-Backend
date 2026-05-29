/**
 * Pagination Types
 */

export interface PaginationParams {
  cursor?: string;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
  total?: number;
}

export interface CursorPayload {
  id: string;
  created_at: string;
}
