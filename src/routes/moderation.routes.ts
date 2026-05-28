import { Router } from "express";
import { ModerationController } from "../controllers/moderation.controller";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

// Add DELETE endpoint for flag deletion
router.delete("/:id", asyncHandler(ModerationController.deleteFlag));

export default router;
