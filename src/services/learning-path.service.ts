import { Logger } from "../utils/logger.utils";

export interface LearningGoal {
  id: string;
  userId: string;
  title: string;
  targetSkills: string[];
  careerAspiration: string;
  deadline?: Date;
}

export interface LearningPathStep {
  id: string;
  title: string;
  description: string;
  skills: string[];
  estimatedDuration: number;
  prerequisites: string[];
  resources: Array<{ type: string; url: string; title: string }>;
  completed: boolean;
}

export interface LearningPath {
  id: string;
  userId: string;
  goal: LearningGoal;
  steps: LearningPathStep[];
  progress: number;
  createdAt: Date;
  updatedAt: Date;
}

import { PrerequisiteValidatorService, Prerequisite } from "./prerequisite-validator.service";
import { createError } from "../middleware/errorHandler";

export class LearningPathService {
  private paths: Map<string, LearningPath> = new Map();
  private pathPrerequisites: Map<string, Prerequisite[]> = new Map(); // Mock DB for prerequisites


  async generatePath(
    goal: LearningGoal,
    currentSkills: string[],
  ): Promise<LearningPath> {
    logger.info(
      { goalId: goal.id, userId: goal.userId },
      "Generating learning path",
    );

    const skillGaps = this.identifySkillGaps(currentSkills, goal.targetSkills);
    const steps = await this.createLearningSteps(skillGaps, goal);

    const path: LearningPath = {
      id: Math.random().toString(36),
      userId: goal.userId,
      goal,
      steps,
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.paths.set(path.id, path);
    this.pathPrerequisites.set(path.id, []);
    return path;
  }

  async addPrerequisite(pathId: string, prerequisite: Prerequisite): Promise<Prerequisite> {
    const path = this.paths.get(pathId);
    if (!path) throw createError("Path not found", 404);

    const currentPrerequisites = this.pathPrerequisites.get(pathId) || [];
    
    // Create a copy and add the new prerequisite to check for cycles
    const proposedPrerequisites = [...currentPrerequisites, prerequisite];
    
    // Check for cycles using Kahn's algorithm
    const cyclePath = PrerequisiteValidatorService.detectCyclesKahn(proposedPrerequisites);
    
    if (cyclePath) {
      throw createError(`Cycle detected involving milestones: ${cyclePath.join(' -> ')}`, 422);
    }
    
    // No cycle detected, save prerequisite
    currentPrerequisites.push(prerequisite);
    this.pathPrerequisites.set(pathId, currentPrerequisites);
    
    return prerequisite;
  }

  async adjustPath(pathId: string, feedback: any): Promise<LearningPath> {
    const path = this.paths.get(pathId);
    if (!path) throw new Error("Path not found");

    logger.info({ pathId }, "Adjusting learning path");

    // Adjust based on feedback
    path.updatedAt = new Date();
    return path;
  }

  async trackProgress(
    pathId: string,
    stepId: string,
    completed: boolean,
  ): Promise<void> {
    const path = this.paths.get(pathId);
    if (!path) throw new Error("Path not found");

    const step = path.steps.find((s) => s.id === stepId);
    if (step) {
      step.completed = completed;
      path.progress =
        path.steps.filter((s) => s.completed).length / path.steps.length;
      path.updatedAt = new Date();
    }
  }

  async getPath(pathId: string): Promise<LearningPath | null> {
    return this.paths.get(pathId) || null;
  }

  async getUserPaths(userId: string): Promise<LearningPath[]> {
    return Array.from(this.paths.values()).filter(
      (path) => path.userId === userId,
    );
  }

  private identifySkillGaps(
    currentSkills: string[],
    targetSkills: string[],
  ): string[] {
    return targetSkills.filter((skill) => !currentSkills.includes(skill));
  }

  private async createLearningSteps(
    skills: string[],
    goal: LearningGoal,
  ): Promise<LearningPathStep[]> {
    const steps: LearningPathStep[] = [];

    for (const skill of skills) {
      steps.push({
        id: Math.random().toString(36),
        title: `Learn ${skill}`,
        description: `Master the fundamentals of ${skill}`,
        skills: [skill],
        estimatedDuration: 40,
        prerequisites: [],
        resources: [
          { type: "video", url: "#", title: `${skill} Tutorial` },
          { type: "article", url: "#", title: `${skill} Guide` },
        ],
        completed: false,
      });
    }

    return steps;
  }
}

export const learningPathService = new LearningPathService();
