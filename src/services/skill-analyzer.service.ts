/**
 * Skill Analyzer Service
 * Analyzes skill gaps and provides recommendations
 * Issue #874
 */

import { Logger } from "../utils/logger.utils";

export interface SkillCategory {
  category: string;
  skills: string[];
  weight: number;
}

export class SkillAnalyzerService {
  private logger: Logger;
  private skillTaxonomy: Map<string, string[]> = new Map();

  constructor() {
    this.logger = new Logger('SkillAnalyzer');
    this.initializeSkillTaxonomy();
  }

  private initializeSkillTaxonomy(): void {
    // Define skill hierarchies and relationships
    this.skillTaxonomy.set('programming', [
      'javascript', 'typescript', 'python', 'java', 'react', 'node.js', 'angular'
    ]);
    this.skillTaxonomy.set('data-science', [
      'python', 'r', 'machine-learning', 'statistics', 'data-visualization'
    ]);
    this.skillTaxonomy.set('design', [
      'ui-design', 'ux-design', 'figma', 'adobe-xd', 'user-research'
    ]);
    this.skillTaxonomy.set('management', [
      'project-management', 'team-leadership', 'agile', 'scrum', 'communication'
    ]);
  }

  public analyzeSkillGap(mentorSkills: string[], menteeSkills: string[]): number {
    const menteeSet = new Set(menteeSkills.map(s => s.toLowerCase()));
    const mentorSet = new Set(mentorSkills.map(s => s.toLowerCase()));

    // Skills mentor has that mentee doesn't
    const teachableSkills = Array.from(mentorSet).filter(skill => !menteeSet.has(skill));

    if (teachableSkills.length === 0) return 0;

    // Calculate complementarity score
    const complementarityScore = teachableSkills.length / (mentorSkills.length + menteeSkills.length);

    // Bonus for related skills
    const relatedSkillsBonus = this.calculateRelatedSkillsBonus(teachableSkills, Array.from(menteeSet));

    return Math.min(complementarityScore + relatedSkillsBonus, 1.0);
  }

  private calculateRelatedSkillsBonus(teachableSkills: string[], menteeSkills: string[]): number {
    let bonus = 0;

    for (const teachable of teachableSkills) {
      for (const menteeSkill of menteeSkills) {
        if (this.areSkillsRelated(teachable, menteeSkill)) {
          bonus += 0.1;
        }
      }
    }

    return Math.min(bonus, 0.3);
  }

  private areSkillsRelated(skill1: string, skill2: string): boolean {
    for (const [category, skills] of this.skillTaxonomy.entries()) {
      if (skills.includes(skill1.toLowerCase()) && skills.includes(skill2.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  public categorizeSkills(skills: string[]): SkillCategory[] {
    const categories: SkillCategory[] = [];

    for (const [category, categorySkills] of this.skillTaxonomy.entries()) {
      const matchingSkills = skills.filter(skill =>
        categorySkills.includes(skill.toLowerCase())
      );

      if (matchingSkills.length > 0) {
        categories.push({
          category,
          skills: matchingSkills,
          weight: matchingSkills.length / skills.length,
        });
      }
    }

    return categories.sort((a, b) => b.weight - a.weight);
  }

  public recommendSkillPath(currentSkills: string[], targetSkills: string[]): string[] {
    const path: string[] = [];
    const current = new Set(currentSkills.map(s => s.toLowerCase()));
    const targets = new Set(targetSkills.map(s => s.toLowerCase()));

    // Find prerequisite skills
    for (const target of targets) {
      if (!current.has(target)) {
        const prerequisites = this.getPrerequisites(target);
        path.push(...prerequisites.filter(p => !current.has(p) && !path.includes(p)));
        path.push(target);
      }
    }

    return path;
  }

  private getPrerequisites(skill: string): string[] {
    // Simplified prerequisite logic
    const prerequisites: { [key: string]: string[] } = {
      'react': ['javascript', 'html', 'css'],
      'typescript': ['javascript'],
      'machine-learning': ['python', 'statistics'],
      'data-visualization': ['python'],
      'node.js': ['javascript'],
    };

    return prerequisites[skill.toLowerCase()] || [];
  }
}
