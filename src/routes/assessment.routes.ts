import { Router } from "express";
import {
  authenticate,
  AuthenticatedRequest,
} from "../middleware/auth.middleware";
import { AssessmentService } from "../services/assessment.service";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { Response } from "express";

const router = Router();

/**
 * @swagger
 * /assessments:
 *   get:
 *     summary: List all assessments
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: skill
 *         schema: { type: string }
 *       - in: query
 *         name: difficulty
 *         schema: { type: string, enum: [beginner, intermediate, advanced] }
 *     responses:
 *       200:
 *         description: List of assessments
 */
router.get(
  "/",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { skill, difficulty } = req.query as {
      skill?: string;
      difficulty?: string;
    };
    const assessments = await AssessmentService.listAssessments(
      skill,
      difficulty,
    );
    res.json({ success: true, data: assessments });
  }),
);

/**
 * @swagger
 * /assessments:
 *   post:
 *     summary: Create a new assessment
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, skill, difficulty, questions]
 *             properties:
 *               title: { type: string }
 *               skill: { type: string }
 *               difficulty: { type: string, enum: [beginner, intermediate, advanced] }
 *               questions: { type: array }
 *               time_limit: { type: integer }
 *               passing_score: { type: integer }
 *               adaptive_enabled: { type: boolean }
 *     responses:
 *       201:
 *         description: Assessment created
 */
router.post(
  "/",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const assessment = await AssessmentService.createAssessment({
      ...req.body,
      created_by: req.user!.userId,
    });
    res.status(201).json({ success: true, data: assessment });
  }),
);

/**
 * @swagger
 * /assessments/{id}:
 *   get:
 *     summary: Get assessment by ID
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Assessment details
 *       404:
 *         description: Not found
 */
router.get(
  "/:id",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const assessment = await AssessmentService.getAssessment(req.params.id as string);
    res.json({ success: true, data: assessment });
  }),
);

/**
 * @swagger
 * /assessments/{id}/submit:
 *   post:
 *     summary: Submit answers for an assessment
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [answers]
 *             properties:
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     questionId: { type: string }
 *                     selectedOption: { type: integer }
 *     responses:
 *       200:
 *         description: Assessment result
 */
router.post(
  "/:id/submit",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await AssessmentService.submitAssessment({
      user_id: req.user!.userId,
      assessment_id: req.params.id as string,
      answers: req.body.answers,
    });
    res.json({ success: true, data: result });
  }),
);

/**
 * @swagger
 * /assessments/results/me:
 *   get:
 *     summary: Get current user's assessment results
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's assessment results
 */
router.get(
  "/results/me",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const results = await AssessmentService.getUserResults(req.user!.userId);
    res.json({ success: true, data: results });
  }),
);

/**
 * @swagger
 * /assessments/{id}/next-question:
 *   post:
 *     summary: Get the next adaptively-selected question for an adaptive assessment
 *     description: |
 *       For adaptive assessments (`adaptive_enabled=true`), returns the next
 *       question selected by the IRT (Rasch) engine based on the current ability
 *       estimate. Call this endpoint to start a session (no prior answers) or
 *       to fetch the next question after each submission via `POST /:id/submit`.
 *       Returns `terminated=true` with `question=null` when SE(θ) < 0.3 or the
 *       maximum of 15 questions has been reached.
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Next question and IRT state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     question:
 *                       type: object
 *                       nullable: true
 *                     theta: { type: number, description: "Current ability estimate" }
 *                     se: { type: number, description: "Standard error of θ" }
 *                     terminated: { type: boolean }
 *       400:
 *         description: Assessment is not adaptive
 *       404:
 *         description: Assessment not found
 */
router.post(
  "/:id/next-question",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await (AssessmentService as any).getNextQuestion(
      req.params.id as string,
      req.user!.userId,
    );
    res.json({ success: true, data: result });
  }),
);

export default router;

