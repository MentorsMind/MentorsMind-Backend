import { Request, Response } from 'express';
import { SearchService } from '../services/search.service';

export const findMentors = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
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
