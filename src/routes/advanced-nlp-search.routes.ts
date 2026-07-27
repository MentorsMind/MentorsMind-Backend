/**
 * Advanced NLP Search Routes
 * 
 * Natural language mentor search with intent extraction
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { AdvancedNlpSearchController } from "../controllers/advanced-nlp-search.controller";

const router = Router();

/**
 * POST /api/v1/search/mentors/nlp
 * Search mentors using natural language query
 */
router.post("/mentors/nlp", authenticate, async (req, res, next) => {
  await AdvancedNlpSearchController.searchMentorsNlp(req, res, next);
});

/**
 * GET /api/v1/search/parse
 * Parse query to see extracted intent
 */
router.get("/parse", authenticate, async (req, res, next) => {
  await AdvancedNlpSearchController.parseQuery(req, res, next);
});

/**
 * GET /api/v1/search/suggestions
 * Get search suggestions for autocomplete
 */
router.get("/suggestions", async (req, res, next) => {
  await AdvancedNlpSearchController.getSuggestions(req, res, next);
});

/**
 * POST /api/v1/search/explain
 * Explain what the system understood about a query
 */
router.post("/explain", authenticate, async (req, res, next) => {
  await AdvancedNlpSearchController.explainQuery(req, res, next);
});

export default router;
