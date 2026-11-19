import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { SearchService, GlobalSearchResultType } from '../services/search.service';

export const findMentors = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const results = await SearchService.searchMentors(req.query, userId);
    return res.status(200).json({
      success: true,
      data: results.mentors,
      meta: results.meta
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Search failed' });
  }
};

export const autocomplete = async (req: Request, res: Response) => {
  try {
    const { query } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const queryString = Array.isArray(query) ? query[0] : query;
    
    if (!queryString || queryString.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'Query must be at least 2 characters' 
      });
    }

    const suggestions = await SearchService.autocomplete(queryString, limit);
    return res.status(200).json({
      success: true,
      data: suggestions
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Autocomplete failed' });
  }
};

export const getSimilarMentors = async (req: Request, res: Response) => {
  try {
    const { mentorId } = req.params;
    const limit = parseInt(req.query.limit as string) || 5;

    const mentorIdString = Array.isArray(mentorId) ? mentorId[0] : mentorId;

    const similarMentors = await SearchService.getSimilarMentors(mentorIdString, limit);
    return res.status(200).json({
      success: true,
      data: similarMentors
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to get similar mentors' });
  }
};

export const getPopularSearches = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const popularSearches = await SearchService.getPopularSearches(limit);
    return res.status(200).json({
      success: true,
      data: popularSearches
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to get popular searches' });
  }
};

/**
 * GET /api/v1/search?q=<query>&types=mentors,sessions,messages&page=1&limit=10
 *
 * Unified search across mentors, sessions, and messages.
 * Requires authentication so session/message results are scoped to the caller.
 */
export const globalSearch = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const q = ((req.query.q as string) || '').trim();
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query (q) must be at least 2 characters',
      });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));

    // Parse optional types filter: e.g. ?types=mentors,sessions
    const rawTypes = (req.query.types as string) || '';
    const aliasMap: Record<string, GlobalSearchResultType> = {
      mentors: 'mentor',
      mentor: 'mentor',
      sessions: 'session',
      session: 'session',
      messages: 'message',
      message: 'message',
    };
    const types: GlobalSearchResultType[] = rawTypes
      ? rawTypes
          .split(',')
          .map((t) => aliasMap[t.trim().toLowerCase()])
          .filter((t): t is GlobalSearchResultType => !!t)
      : [];

    const result = await SearchService.globalSearch({
      query: q,
      userId,
      page,
      limit,
      types: types.length > 0 ? types : undefined,
    });

    return res.status(200).json({
      success: true,
      data: result.results,
      meta: result.meta,
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Global search failed' });
  }
};
