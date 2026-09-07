import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { AdvancedSearchService, AdvancedSearchFilters } from "../services/advanced-search.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";

export const SearchV2Controller = {
  searchMentors: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;

    // Parse filters from query parameters
    const query = (req.query.query as string) || (req.query.q as string);
    const skills = req.query.skills
      ? Array.isArray(req.query.skills)
        ? (req.query.skills as string[])
        : (req.query.skills as string).split(",").map((s) => s.trim())
      : undefined;

    const languages = req.query.languages
      ? Array.isArray(req.query.languages)
        ? (req.query.languages as string[])
        : (req.query.languages as string).split(",").map((l) => l.trim())
      : undefined;

    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined;
    const minRating = req.query.minRating ? parseFloat(req.query.minRating as string) : undefined;
    const isVerified = req.query.isVerified !== undefined ? req.query.isVerified === "true" : undefined;
    const sortBy = req.query.sortBy as any;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

    const filters: AdvancedSearchFilters = {
      query,
      skills,
      languages,
      minPrice,
      maxPrice,
      minRating,
      isVerified,
      sortBy,
      page,
      limit,
      timezone: req.query.timezone as string,
    };

    const results = await AdvancedSearchService.searchMentors(filters, userId);

    ResponseUtil.success(
      res,
      {
        mentors: results.mentors,
        facets: results.facets,
      },
      "Mentors found",
      200,
      results.pagination
    );
  }),

  /**
   * GET /api/v2/search/recommendations
   * Get personalized mentor recommendations based on learner profile and learning goals
   */
  getRecommendations: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      return ResponseUtil.error(res, "Authentication required for recommendations", 401);
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const mentors = await AdvancedSearchService.getRecommendedMentors(userId, limit);

    ResponseUtil.success(res, { mentors }, "Recommended mentors retrieved");
  }),

  /**
   * POST /api/v2/search/saved
   * Save a search configuration / preset
   */
  saveSearch: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      return ResponseUtil.error(res, "Authentication required", 401);
    }

    const { name, filters, notifyOnMatch = true } = req.body;
    if (!name || typeof name !== "string") {
      return ResponseUtil.error(res, "Search preset name is required", 400);
    }

    const saved = await AdvancedSearchService.saveSearch(
      userId,
      name,
      filters || {},
      notifyOnMatch
    );

    ResponseUtil.success(res, saved, "Search preset saved", 201);
  }),

  /**
   * GET /api/v2/search/saved
   * Get all saved searches for the authenticated user
   */
  getSavedSearches: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      return ResponseUtil.error(res, "Authentication required", 401);
    }

    const savedSearches = await AdvancedSearchService.getSavedSearches(userId);
    ResponseUtil.success(res, { savedSearches }, "Saved searches retrieved");
  }),

  /**
   * GET /api/v2/search/saved/:id/execute
   * Execute a saved search preset
   */
  executeSavedSearch: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { id } = req.params as Record<string, string>;
    if (!userId) {
      return ResponseUtil.error(res, "Authentication required", 401);
    }

    const savedSearch = await AdvancedSearchService.getSavedSearchById(id, userId);
    if (!savedSearch) {
      return ResponseUtil.error(res, "Saved search not found", 404);
    }

    const results = await AdvancedSearchService.searchMentors(savedSearch.filters, userId);
    ResponseUtil.success(res, results, "Saved search executed");
  }),

  /**
   * DELETE /api/v2/search/saved/:id
   * Delete a saved search preset
   */
  deleteSavedSearch: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { id } = req.params as Record<string, string>;
    if (!userId) {
      return ResponseUtil.error(res, "Authentication required", 401);
    }

    const deleted = await AdvancedSearchService.deleteSavedSearch(id, userId);
    if (!deleted) {
      return ResponseUtil.error(res, "Saved search not found", 404);
    }

    ResponseUtil.success(res, null, "Saved search deleted");
  }),
};

export default SearchV2Controller;
