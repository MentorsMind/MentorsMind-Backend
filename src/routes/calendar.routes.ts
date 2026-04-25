import { Router } from "express";
import rateLimit from "express-rate-limit";
import { CalendarController } from "../controllers/calendar.controller";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

// Rate limiter for the public (unauthenticated) iCal feed endpoint.
// 10 requests per minute per IP prevents brute-forcing the token space
// while still accommodating legitimate calendar clients that poll frequently.
const icalFeedLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: {
    success: false,
    error: "Too many requests to the iCal feed. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Public iCal feed (rate-limited) ──────────────────────────────────────────
router.get(
  "/ical/:token",
  icalFeedLimiter,
  asyncHandler(CalendarController.getICalFeed),
);

// ── Authenticated iCal token management ──────────────────────────────────────
router.get(
  "/ical/token",
  authenticate,
  asyncHandler(CalendarController.getICalToken),
);
router.post(
  "/ical/regenerate",
  authenticate,
  asyncHandler(CalendarController.regenerateICalToken),
);

// ── Google Calendar OAuth ─────────────────────────────────────────────────────
router.get(
  "/google/connect",
  authenticate,
  asyncHandler(CalendarController.googleConnect),
);
router.get("/google/callback", asyncHandler(CalendarController.googleCallback));
router.delete(
  "/google/disconnect",
  authenticate,
  asyncHandler(CalendarController.googleDisconnect),
);

export default router;
