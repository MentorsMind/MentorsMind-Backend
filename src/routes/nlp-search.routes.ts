import { Router } from "express";
import { NlpSearchController } from "../controllers/nlp-search.controller";

const router = Router();

// NLP-powered natural language mentor search
router.get("/nlp", NlpSearchController.search);

// Query autocomplete suggestions (Elasticsearch prefix search)
router.get("/suggestions", NlpSearchController.getSuggestions);

// Structured query parsing / intent extraction
router.get("/parse", NlpSearchController.parseQuery);

export default router;
