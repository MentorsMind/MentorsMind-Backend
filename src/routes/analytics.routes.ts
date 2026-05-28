import { Router } from "express";
import { AnalyticsController } from "../controllers/analytics.controller";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";

const router = Router();

// All analytics routes require authentication
router.use(authenticate);

/**
 * Learning Path Analytics Routes
 */

// Get comprehensive analytics for a learning path
// GET /api/v1/analytics/paths/:pathId
router.get(
  "/paths/:pathId",
  authorize(["mentor", "admin"]),
  AnalyticsController.getPathAnalytics
);

// Get milestone analytics for a learning path
// GET /api/v1/analytics/paths/:pathId/milestones
router.get(
  "/paths/:pathId/milestones",
  authorize(["mentor", "admin"]),
  AnalyticsController.getMilestoneAnalytics
);

// Get trend data for a learning path
// GET /api/v1/analytics/paths/:pathId/trends
router.get(
  "/paths/:pathId/trends",
  authorize(["mentor", "admin"]),
  AnalyticsController.getTrendData
);

// Get bottlenecks for a learning path
// GET /api/v1/analytics/paths/:pathId/bottlenecks
router.get(
  "/paths/:pathId/bottlenecks",
  authorize(["mentor", "admin"]),
  AnalyticsController.getBottlenecks
);

/**
 * Student Analytics Routes
 */

// Get student learning profile
// GET /api/v1/analytics/students/:studentId/profile
router.get(
  "/students/:studentId/profile",
  authorize(["student", "mentor", "admin"]),
  AnalyticsController.getStudentProfile
);

// Get predictive insights for a student in a specific path
// GET /api/v1/analytics/students/:studentId/paths/:pathId/insights
router.get(
  "/students/:studentId/paths/:pathId/insights",
  authorize(["student", "mentor", "admin"]),
  AnalyticsController.getPredictiveInsights
);

// Get comparison analytics (student vs peers)
// GET /api/v1/analytics/students/:studentId/paths/:pathId/comparison
router.get(
  "/students/:studentId/paths/:pathId/comparison",
  authorize(["student", "mentor", "admin"]),
  AnalyticsController.getComparisonAnalytics
);

/**
 * Mentor Analytics Routes
 */

// Get mentor dashboard analytics
// GET /api/v1/analytics/mentors/:mentorId/dashboard
router.get(
  "/mentors/:mentorId/dashboard",
  authorize(["mentor", "admin"]),
  AnalyticsController.getMentorDashboard
);

export default router;
