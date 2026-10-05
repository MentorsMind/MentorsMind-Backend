/**
 * Relevance Engine Service
 * Custom relevance scoring algorithms for search optimization
 * Issue #872
 */

import { Logger } from "../utils/logger.utils";

export interface RelevanceWeights {
  titleMatch: number;
  contentMatch: number;
  tagMatch: number;
  recency: number;
  popularity: number;
  userEngagement: number;
}

export class RelevanceEngineService {
  private logger: Logger;
  private weights: RelevanceWeights;

  constructor() {
    this.logger = new Logger('RelevanceEngine');
    this.weights = {
      titleMatch: 0.35,
      contentMatch: 0.20,
      tagMatch: 0.15,
      recency: 0.10,
      popularity: 0.10,
      userEngagement: 0.10,
    };
  }

  public calculateRelevanceScore(document: any, query: string, context: any = {}): number {
    let score = 0;

    // Title match scoring
    score += this.scoreTitleMatch(document.title, query) * this.weights.titleMatch;

    // Content match scoring
    score += this.scoreContentMatch(document.content, query) * this.weights.contentMatch;

    // Tag match scoring
    score += this.scoreTagMatch(document.tags, query) * this.weights.tagMatch;

    // Recency scoring
    score += this.scoreRecency(document.createdAt) * this.weights.recency;

    // Popularity scoring
    score += this.scorePopularity(document.views, document.likes) * this.weights.popularity;

    // User engagement scoring
    score += this.scoreEngagement(document.comments, document.shares) * this.weights.userEngagement;

    return Math.min(Math.max(score, 0), 1); // Normalize to 0-1
  }

  private scoreTitleMatch(title: string, query: string): number {
    if (!title || !query) return 0;
    
    const titleLower = title.toLowerCase();
    const queryLower = query.toLowerCase();
    
    // Exact match gets highest score
    if (titleLower === queryLower) return 1.0;
    
    // Contains full query
    if (titleLower.includes(queryLower)) return 0.8;
    
    // Word-level matching
    const queryWords = queryLower.split(' ');
    const matchedWords = queryWords.filter(word => titleLower.includes(word));
    
    return matchedWords.length / queryWords.length * 0.6;
  }

  private scoreContentMatch(content: string, query: string): number {
    if (!content || !query) return 0;
    
    const contentLower = content.toLowerCase();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(' ');
    
    let matches = 0;
    for (const word of queryWords) {
      const regex = new RegExp(word, 'gi');
      const wordMatches = (content.match(regex) || []).length;
      matches += Math.min(wordMatches / 10, 1); // Cap per-word contribution
    }
    
    return Math.min(matches / queryWords.length, 1);
  }

  private scoreTagMatch(tags: string[], query: string): number {
    if (!tags || tags.length === 0) return 0;
    
    const queryLower = query.toLowerCase();
    const matchingTags = tags.filter(tag => 
      tag.toLowerCase().includes(queryLower) || queryLower.includes(tag.toLowerCase())
    );
    
    return matchingTags.length > 0 ? 1.0 : 0;
  }

  private scoreRecency(createdAt: Date | string): number {
    const now = Date.now();
    const created = new Date(createdAt).getTime();
    const ageInDays = (now - created) / (1000 * 60 * 60 * 24);
    
    // Decay function: newer content scores higher
    if (ageInDays < 7) return 1.0;
    if (ageInDays < 30) return 0.8;
    if (ageInDays < 90) return 0.6;
    if (ageInDays < 180) return 0.4;
    return 0.2;
  }

  private scorePopularity(views: number, likes: number): number {
    const popularityScore = Math.log10(1 + views + likes * 5);
    return Math.min(popularityScore / 5, 1); // Normalize
  }

  private scoreEngagement(comments: number, shares: number): number {
    const engagementScore = Math.log10(1 + comments * 2 + shares * 3);
    return Math.min(engagementScore / 4, 1); // Normalize
  }

  public applyFuzzyMatching(query: string, maxDistance: number = 2): any {
    return {
      fuzzy: {
        query,
        fuzziness: 'AUTO',
        max_expansions: 50,
        prefix_length: 2,
      },
    };
  }

  public buildMultiFieldQuery(query: string, fields: string[]): any {
    return {
      multi_match: {
        query,
        fields: fields.map(field => `${field}^${this.getFieldBoost(field)}`),
        type: 'best_fields',
        tie_breaker: 0.3,
        minimum_should_match: '75%',
      },
    };
  }

  private getFieldBoost(field: string): number {
    const boosts: { [key: string]: number } = {
      title: 3.0,
      tags: 2.0,
      content: 1.0,
      description: 1.5,
    };
    return boosts[field] || 1.0;
  }
}
