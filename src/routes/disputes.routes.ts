import { Router } from "express";
import { DisputesController } from "../controllers/disputes.controller";

const router = Router();

// Middleware placeholder for authentication (assume it's attached where this router is mounted)

// User/Admin routes
router.get("/templates/resolution", DisputesController.getResolutionTemplates);
router.get("/", DisputesController.listDisputes);
router.post("/", DisputesController.openDispute);
router.get("/:id", DisputesController.getDispute);
router.post("/:id/evidence", DisputesController.uploadEvidence);

// Admin-only routes
router.post("/:id/resolve", DisputesController.resolveDispute);
router.post("/:id/mediate", DisputesController.mediateDispute);

export default router;
