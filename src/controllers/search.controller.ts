import { Request, Response } from 'express';
import { SearchService } from '../services/search.service';

export const findMentors = async (req: Request, res: Response) => {
  try {
    const results = await SearchService.searchMentors(req.query);
    return res.status(200).json({
      success: true,
      data: results.mentors,
      meta: results.meta
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Search failed' });
  }
};
