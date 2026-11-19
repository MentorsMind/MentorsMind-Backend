import axios from "axios";
import { logger } from "../utils/logger.utils";

export interface CodeIssue {
  line: number;
  column: number;
  severity: "info" | "warning" | "error" | "critical";
  rule: string;
  message: string;
  suggestion: string;
}

export interface Suggestion {
  type: string;
  description: string;
  example?: string;
}

export interface CodeReview {
  submissionId: string;
  language: string;
  issues: CodeIssue[];
  qualityScore: number;
  securityScore: number;
  suggestions: Suggestion[];
  aiReview: string;
  plagiarismScore: number;
}

export interface ReviewHistory {
  id: string;
  submissionId: string;
  reviewedAt: Date;
  review: CodeReview;
}

export class CodeReviewService {
  private readonly openaiApiKey = process.env.OPENAI_API_KEY;
  private readonly reviewHistory: ReviewHistory[] = [];
  private readonly plagiarismDatabase = new Map();

  async reviewCode(
    submissionId: string,
    code: string,
    language: string,
  ): Promise<CodeReview> {
    logger.info(`Starting code review for submission ${submissionId}`);

    const [issues, aiReview, plagiarismScore] = await Promise.all([
      this.runStaticAnalysis(code, language),
      this.getAiReview(code, language),
      this.checkPlagiarism(code),
    ]);

    const qualityScore = this.calculateQualityScore(issues);
    const securityScore = this.calculateSecurityScore(issues);
    const suggestions = this.generateSuggestions(issues, language);

    const review: CodeReview = {
      submissionId,
      language,
      issues,
      qualityScore,
      securityScore,
      suggestions,
      aiReview,
      plagiarismScore,
    };

    this.reviewHistory.push({
      id: `review-${Date.now()}`,
      submissionId,
      reviewedAt: new Date(),
      review,
    });

    logger.info(
      `Code review completed for submission ${submissionId}: quality=${qualityScore}, security=${securityScore}`,
    );
    return review;
  }

  private async runStaticAnalysis(
    code: string,
    language: string,
  ): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];
    const lines = code.split("\n");

    lines.forEach((line, index) => {
      // Security: detect eval usage
      if (/\beval\s*\(/.test(line)) {
        issues.push({
          line: index + 1,
          column: line.indexOf("eval") + 1,
          severity: "critical",
          rule: "no-eval",
          message: "Use of eval() is a security risk",
          suggestion: "Replace eval() with safer alternatives",
        });
      }
      // Security: hardcoded secrets
      if (/(password|secret|api_key)\s*=\s*['"][^'"]+['"]/i.test(line)) {
        issues.push({
          line: index + 1,
          column: 1,
          severity: "critical",
          rule: "no-hardcoded-secrets",
          message: "Hardcoded secret detected",
          suggestion: "Use environment variables for sensitive values",
        });
      }
      // Style: console.log in production code
      if (/console\.(log|debug)\s*\(/.test(line) && language === "javascript") {
        issues.push({
          line: index + 1,
          column: line.search(/console/) + 1,
          severity: "warning",
          rule: "no-console",
          message: "Avoid console.log in production code",
          suggestion: "Use a proper logging library",
        });
      }
    });

    return issues;
  }

  private async getAiReview(code: string, language: string): Promise<string> {
    if (!this.openaiApiKey) {
      return "AI review unavailable: OPENAI_API_KEY not configured";
    }
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content:
                "You are an expert code reviewer. Provide concise, actionable feedback.",
            },
            {
              role: "user",
              content: `Review this ${language} code for quality, security, and best practices:\n\n${code}`,
            },
          ],
          max_tokens: 500,
        },
        { headers: { Authorization: `Bearer ${this.openaiApiKey}` } },
      );
      return response.data.choices[0].message.content;
    } catch (err) {
      logger.error("AI review failed", err);
      return "AI review temporarily unavailable";
    }
  }

  private async checkPlagiarism(code: string): Promise<number> {
    try {
      // Normalize code for comparison (remove whitespace, comments, etc.)
      const normalizedCode = this.normalizeCodeForPlagiarismCheck(code);
      
      // If code is too short, consider it original
      if (normalizedCode.length < 50) {
        return 0;
      }

      // Calculate hash for current code
      const currentHash = this.generateCodeHash(normalizedCode);
      
      // Check against stored submissions (in a real implementation, this would query a database)
      const similarSubmissions = await this.findSimilarSubmissions(currentHash, normalizedCode);
      
      if (similarSubmissions.length === 0) {
        // No similar submissions found - store this submission's signature
        await this.storeSubmissionSignature(currentHash, normalizedCode);
        return 0;
      }

      // Calculate similarity percentage with the most similar submission
      const highestSimilarity = Math.max(...similarSubmissions.map(sub => 
        this.calculateCodeSimilarity(normalizedCode, sub.normalizedCode)
      ));

      // Convert similarity to plagiarism score (0-100)
      const plagiarismScore = Math.min(100, Math.max(0, highestSimilarity));
      
      logger.info(`Plagiarism check completed: score=${plagiarismScore}%, similar_submissions=${similarSubmissions.length}`);
      
      return plagiarismScore;
    } catch (error) {
      logger.error('Plagiarism check failed:', error);
      // Fallback to basic heuristic instead of random
      return this.basicSimilarityHeuristic(code);
    }
  }

  private normalizeCodeForPlagiarismCheck(code: string): string {
    return code
      // Remove comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/#.*$/gm, '')
      // Remove string literals (replace with placeholder)
      .replace(/'[^']*'/g, "'STR'")
      .replace(/"[^"]*"/g, '"STR"')
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private generateCodeHash(code: string): string {
    // Simple hash function for quick lookups
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      const char = code.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private async findSimilarSubmissions(hash: string, normalizedCode: string): Promise<Array<{normalizedCode: string, hash: string}>> {
    // Search the plagiarism database for similar submissions (by hash)
    const results: Array<{normalizedCode: string, hash: string}> = [];
    for (const [storedHash, storedCode] of this.plagiarismDatabase) {
      if (storedHash === hash) {
        results.push({ normalizedCode: storedCode, hash: storedHash });
      }
    }
    return results;
  }

  private async storeSubmissionSignature(hash: string, normalizedCode: string): Promise<void> {
    // Store the submission signature in the plagiarism database
    this.plagiarismDatabase.set(hash, normalizedCode);
    logger.debug(`Storing submission signature: hash=${hash}, length=${normalizedCode.length}`);
  }

  private calculateCodeSimilarity(code1: string, code2: string): number {
    // Use Levenshtein distance to calculate similarity
    const distance = this.levenshteinDistance(code1, code2);
    const maxLength = Math.max(code1.length, code2.length);
    
    if (maxLength === 0) return 100;
    
    const similarity = (1 - distance / maxLength) * 100;
    return Math.max(0, similarity);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i += 1) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j += 1) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator, // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  private basicSimilarityHeuristic(code: string): number {
    // Fallback heuristic when plagiarism service fails
    const lines = code.trim().split('\n');
    const uniqueLines = new Set(lines.map(line => line.trim())).size;
    const repetitionRatio = 1 - (uniqueLines / lines.length);
    
    // High repetition might indicate copy-paste
    return Math.min(50, repetitionRatio * 100);
  }

  private calculateQualityScore(issues: CodeIssue[]): number {
    const deductions = issues.reduce((sum, issue) => {
      const weights = { info: 1, warning: 5, error: 15, critical: 25 };
      return sum + weights[issue.severity];
    }, 0);
    return Math.max(0, 100 - deductions);
  }

  private calculateSecurityScore(issues: CodeIssue[]): number {
    const securityIssues = issues.filter((i) =>
      ["no-eval", "no-hardcoded-secrets"].includes(i.rule),
    );
    const deductions = securityIssues.reduce((sum, issue) => {
      const weights = { info: 2, warning: 10, error: 25, critical: 40 };
      return sum + weights[issue.severity];
    }, 0);
    return Math.max(0, 100 - deductions);
  }

  private generateSuggestions(
    issues: CodeIssue[],
    language: string,
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];

    if (issues.some((i) => i.severity === "critical")) {
      suggestions.push({
        type: "security",
        description: "Address all critical security issues before deployment",
      });
    }
    if (issues.some((i) => i.rule === "no-console")) {
      suggestions.push({
        type: "best-practice",
        description: `Use a structured logger instead of console statements in ${language}`,
        example: 'import { logger } from "./utils/logger";',
      });
    }

    return suggestions;
  }

  getReviewHistory(submissionId?: string): ReviewHistory[] {
    if (submissionId) {
      return this.reviewHistory.filter((r) => r.submissionId === submissionId);
    }
    return this.reviewHistory;
  }
}

export const codeReviewService = new CodeReviewService();
