import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { MentorOnboardingService } from '../services/mentor-onboarding.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

export const MentorOnboardingController = {
  initialize: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const onboarding = await MentorOnboardingService.initializeOnboarding(userId);
    return ResponseUtil.created(res, { onboarding }, 'Onboarding initialized');
  }),

  progress: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const progress = await MentorOnboardingService.getOnboardingProgress(userId);
    if (!progress) return ResponseUtil.notFound(res, 'Onboarding not started');
    return ResponseUtil.success(res, progress);
  }),

  completeStep: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { stepId } = req.params;
    const onboarding = await MentorOnboardingService.completeStep(userId, stepId);
    return ResponseUtil.success(res, { onboarding }, 'Step completed');
  }),

  pause: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { reason } = req.body;
    await MentorOnboardingService.pauseOnboarding(userId, reason);
    return ResponseUtil.success(res, null, 'Onboarding paused');
  }),

  resume: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    await MentorOnboardingService.resumeOnboarding(userId);
    return ResponseUtil.success(res, null, 'Onboarding resumed');
  }),

  wizardSteps: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const steps = await MentorOnboardingService.getWizardSteps();
    return ResponseUtil.success(res, { steps });
  }),

  profileScore: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const score = await MentorOnboardingService.getProfileScore(userId);
    if (!score) {
      const fresh = await MentorOnboardingService.computeProfileScore(userId);
      return ResponseUtil.success(res, { score: fresh });
    }
    return ResponseUtil.success(res, { score });
  }),

  refreshProfileScore: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const score = await MentorOnboardingService.computeProfileScore(userId);
    return ResponseUtil.success(res, { score }, 'Profile score refreshed');
  }),

  suggestions: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const suggestions = await MentorOnboardingService.getOptimizationSuggestions(userId);
    return ResponseUtil.success(res, { suggestions });
  }),

  emailSequences: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const sequences = await MentorOnboardingService.getEmailSequences();
    return ResponseUtil.success(res, { sequences });
  }),

  checklist: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const items = await MentorOnboardingService.getSuccessChecklist(userId);
    return ResponseUtil.success(res, { items });
  }),

  completeChecklistItem: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { itemKey } = req.params;
    await MentorOnboardingService.completeChecklistItem(userId, itemKey);
    return ResponseUtil.success(res, null, 'Checklist item completed');
  }),

  analytics: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const analytics = await MentorOnboardingService.getOnboardingAnalytics(userId);
    return ResponseUtil.success(res, analytics);
  }),

  adminAnalytics: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const analytics = await MentorOnboardingService.getAdminAnalytics();
    return ResponseUtil.success(res, analytics);
  }),
};
