import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { NlpSearchService } from "../services/nlp-search.service";

export class NlpSearchController {
  static async search(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { q, minRating, maxPrice, language } = req.query;
    const userId = req.user?.id;

    if (!q || typeof q !== "string") {
      res.status(400).json({ success: false, message: "Query 'q' is required" });
      return;
    }

    const overrides = {
      minRating: minRating ? parseFloat(minRating as string) : undefined,
      maxBudget: maxPrice ? parseFloat(maxPrice as string) : undefined,
      language: language as string | undefined,
    };

    const { parsed, results } = await NlpSearchService.search(
      q,
      userId,
      overrides,
    );

    res.json({
      success: true,
      data: { parsed, results },
      total: results.length,
    });
  }

  static async getSuggestions(req: Request, res: Response): Promise<void> {
    const { q } = req.query;
    if (!q || typeof q !== "string") {
      res.status(400).json({ success: false, message: "Query 'q' is required" });
      return;
    }
    const suggestions = await NlpSearchService.getSuggestions(q);
    const corrections = NlpSearchService.detectTypos(q);
    res.json({
      success: true,
      data: { suggestions, corrections },
    });
  }

  static async parseQuery(req: Request, res: Response): Promise<void> {
    const { q } = req.query;
    if (!q || typeof q !== "string") {
      res.status(400).json({ success: false, message: "Query 'q' is required" });
      return;
    }
    const parsed = await NlpSearchService.parseQuery(q);
    res.json({ success: true, data: parsed });
  }
}
