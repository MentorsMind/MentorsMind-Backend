import { body } from 'express-validator';

export const updateLearnerValidator = [
  body('goal_title').optional().isString().trim().isLength({ min: 3 }),
  body('skill_level').optional().isIn(['beginner', 'intermediate', 'advanced']),
  body('interests').optional().isArray(),
];

export const createGoalValidator = [
  body('goal_title').isString().notEmpty().withMessage('Goal title is required'),
  body('target_date').optional().isISO8601().withMessage('Invalid date format'),
];
