import { Client } from '@elastic/elasticsearch';
import config from '../config';
import { logger } from '../utils/logger';

interface SearchQuery {
  query: string;
  filters?: {
    skills?: string[];
    priceRange?: [number, number];
    availability?: string;
    rating?: number;
    languages?: string[];
  };
  page?: number;
  limit?: number;
  sort?: 'relevance' | 'rating' | 'price' | 'newest';
}

interface SearchResult<T> {
  hits: T[];
  total: number;
  page: number;
  limit: number;
  aggregations?: any;
}

interface MentorDocument {
  id: string;
  name: string;
  email: string;
  expertise: string[];
  hourly_rate: number;
  average_rating: number;
  bio: string;
  languages: string[];
  availability: string;
  created_at: string;
  verified: boolean;
}

interface SessionDocument {
  id: string;
  mentor_id: string;
  mentor_name: string;
  learner_id: string;
  title: string;
  description: string;
  skills: string[];
  status: string;
  scheduled_at: string;
  created_at: string;
}

interface ContentDocument {
  id: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  category: string;
  author_id: string;
  author_name: string;
  created_at: string;
}

class ElasticsearchService {
  private client: Client | null = null;
  private isConnected = false;

  constructor() {
    if (config.elasticsearch.enabled) {
      this.initialize();
    }
  }

  private initialize() {
    try {
      const authConfig: any = {
        node: config.elasticsearch.url,
      };

      if (config.elasticsearch.username && config.elasticsearch.password) {
        authConfig.auth = {
          username: config.elasticsearch.username,
          password: config.elasticsearch.password,
        };
      } else if (config.elasticsearch.apiKey) {
        authConfig.auth = {
          apiKey: config.elasticsearch.apiKey,
        };
      }

      this.client = new Client(authConfig);
      this.isConnected = true;
      logger.info('Elasticsearch client initialized');
    } catch (error) {
      logger.error('Failed to initialize Elasticsearch client:', error);
      this.isConnected = false;
    }
  }

  private ensureConnected() {
    if (!this.isConnected || !this.client) {
      throw new Error('Elasticsearch is not connected or not enabled');
    }
  }

  async checkConnection(): Promise<boolean> {
    if (!this.client) return false;
    
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      logger.error('Elasticsearch connection check failed:', error);
      return false;
    }
  }

  // Index Management
  async createIndex(indexName: string, mapping: any): Promise<void> {
    this.ensureConnected();
    
    try {
      const exists = await this.client.indices.exists({ index: indexName });
      
      if (!exists) {
        await this.client.indices.create({
          index: indexName,
          body: {
            mappings: mapping,
            settings: {
              analysis: {
                analyzer: {
                  text_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'stop', 'snowball'],
                  },
                  autocomplete_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'ngram'],
                  },
                },
                filter: {
                  ngram: {
                    type: 'ngram',
                    min_gram: 2,
                    max_gram: 20,
                  },
                },
              },
            },
          },
        });
        logger.info(`Created index: ${indexName}`);
      }
    } catch (error) {
      logger.error(`Failed to create index ${indexName}:`, error);
      throw error;
    }
  }

  async deleteIndex(indexName: string): Promise<void> {
    this.ensureConnected();
    
    try {
      await this.client.indices.delete({ index: indexName });
      logger.info(`Deleted index: ${indexName}`);
    } catch (error) {
      if (error.meta?.statusCode !== 404) {
        logger.error(`Failed to delete index ${indexName}:`, error);
        throw error;
      }
    }
  }

  async indexDocument<T>(indexName: string, id: string, document: T): Promise<void> {
    this.ensureConnected();
    
    try {
      await this.client.index({
        index: indexName,
        id,
        body: document,
        refresh: true,
      });
    } catch (error) {
      logger.error(`Failed to index document ${id} in ${indexName}:`, error);
      throw error;
    }
  }

  async bulkIndex<T>(indexName: string, documents: Array<{ id: string; doc: T }>): Promise<void> {
    this.ensureConnected();
    
    try {
      const bulkBody = documents.flatMap(({ id, doc }) => [
        { index: { _index: indexName, _id: id } },
        doc,
      ]);

      await this.client.bulk({
        body: bulkBody,
        refresh: true,
      });
      
      logger.info(`Bulk indexed ${documents.length} documents in ${indexName}`);
    } catch (error) {
      logger.error(`Failed to bulk index documents in ${indexName}:`, error);
      throw error;
    }
  }

  async deleteDocument(indexName: string, id: string): Promise<void> {
    this.ensureConnected();
    
    try {
      await this.client.delete({
        index: indexName,
        id,
        refresh: true,
      });
    } catch (error) {
      if (error.meta?.statusCode !== 404) {
        logger.error(`Failed to delete document ${id} from ${indexName}:`, error);
        throw error;
      }
    }
  }

  // Search Methods
  async searchMentors(searchQuery: SearchQuery): Promise<SearchResult<MentorDocument>> {
    this.ensureConnected();
    
    const { query, filters = {}, page = 1, limit = 10, sort = 'relevance' } = searchQuery;
    const from = (page - 1) * limit;

    const must: any[] = [];
    const filter: any[] = [];

    // Full-text search
    if (query) {
      must.push({
        bool: {
          should: [
            {
              multi_match: {
                query,
                fields: ['name^3', 'bio^2', 'expertise'],
                fuzziness: config.elasticsearch.search.fuzzyDistance,
                operator: 'and',
              },
            },
            {
              multi_match: {
                query,
                fields: ['name', 'bio', 'expertise'],
                type: 'phrase_prefix',
              },
            },
          ],
        },
      });
    }

    // Apply filters
    if (filters.skills && filters.skills.length > 0) {
      filter.push({
        terms: { expertise: filters.skills },
      });
    }

    if (filters.priceRange) {
      const [minPrice, maxPrice] = filters.priceRange;
      filter.push({
        range: {
          hourly_rate: {
            gte: minPrice,
            lte: maxPrice,
          },
        },
      });
    }

    if (filters.rating) {
      filter.push({
        range: {
          average_rating: {
            gte: filters.rating,
          },
        },
      });
    }

    if (filters.languages && filters.languages.length > 0) {
      filter.push({
        terms: { languages: filters.languages },
      });
    }

    if (filters.availability) {
      filter.push({
        term: { availability: filters.availability },
      });
    }

    // Sorting
    let sortConfig: any[];
    switch (sort) {
      case 'rating':
        sortConfig = [{ average_rating: { order: 'desc' } }];
        break;
      case 'price':
        sortConfig = [{ hourly_rate: { order: 'asc' } }];
        break;
      case 'newest':
        sortConfig = [{ created_at: { order: 'desc' } }];
        break;
      case 'relevance':
      default:
        sortConfig = query ? ['_score'] : [{ created_at: { order: 'desc' } }];
        break;
    }

    try {
      const response = await this.client.search({
        index: config.elasticsearch.indices.mentors,
        body: {
          query: {
            bool: {
              must: must.length > 0 ? must : undefined,
              filter: filter.length > 0 ? filter : undefined,
            },
          },
          sort: sortConfig,
          from,
          size: limit,
          aggregations: {
            skills: {
              terms: { field: 'expertise', size: 20 },
            },
            price_ranges: {
              range: {
                field: 'hourly_rate',
                ranges: [
                  { to: 50, key: 'budget' },
                  { from: 50, to: 100, key: 'standard' },
                  { from: 100, key: 'premium' },
                ],
              },
            },
            rating_ranges: {
              range: {
                field: 'average_rating',
                ranges: [
                  { from: 4.5, key: 'excellent' },
                  { from: 4.0, to: 4.5, key: 'good' },
                  { from: 3.5, to: 4.0, key: 'average' },
                ],
              },
            },
          },
        },
      });

      const hits = response.hits.hits.map((hit: any) => ({
        ...hit._source,
        score: hit._score,
      }));

      return {
        hits,
        total: typeof response.hits.total === 'object' ? response.hits.total.value : response.hits.total,
        page,
        limit,
        aggregations: response.aggregations,
      };
    } catch (error) {
      logger.error('Search mentors failed:', error);
      throw error;
    }
  }

  async autocomplete(query: string, field: string = 'name', limit: number = 10): Promise<string[]> {
    this.ensureConnected();
    
    try {
      const response = await this.client.search({
        index: config.elasticsearch.indices.mentors,
        body: {
          suggest: {
            autocomplete: {
              prefix: query,
              completion: {
                field: `${field}.suggest`,
                size: limit,
              },
            },
          },
        },
      });

      const suggestions = response.suggest?.autocomplete?.[0]?.options?.map((opt: any) => opt.text) || [];
      return suggestions;
    } catch (error) {
      logger.error('Autocomplete failed:', error);
      return [];
    }
  }

  async getSimilarMentors(mentorId: string, limit: number = 5): Promise<MentorDocument[]> {
    this.ensureConnected();
    
    try {
      const response = await this.client.search({
        index: config.elasticsearch.indices.mentors,
        body: {
          query: {
            more_like_this: {
              fields: ['expertise', 'bio'],
              like: [{ _index: config.elasticsearch.indices.mentors, _id: mentorId }],
              min_term_freq: 1,
              min_doc_freq: 1,
            },
          },
          size: limit,
        },
      });

      return response.hits.hits.map((hit: any) => hit._source);
    } catch (error) {
      logger.error('Get similar mentors failed:', error);
      return [];
    }
  }

  // Analytics
  async trackSearch(query: string, filters: any, resultsCount: number, userId?: string): Promise<void> {
    this.ensureConnected();
    
    const analyticsDoc = {
      query,
      filters,
      results_count: resultsCount,
      user_id: userId,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.client.index({
        index: `${config.elasticsearch.indexPrefix}-search-analytics`,
        body: analyticsDoc,
      });
    } catch (error) {
      logger.error('Failed to track search analytics:', error);
    }
  }

  async getPopularSearches(limit: number = 10): Promise<Array<{ query: string; count: number }>> {
    this.ensureConnected();
    
    try {
      const response = await this.client.search({
        index: `${config.elasticsearch.indexPrefix}-search-analytics`,
        body: {
          size: 0,
          aggregations: {
            popular_queries: {
              terms: {
                field: 'query.keyword',
                size: limit,
              },
            },
          },
        },
      });

      return response.aggregations?.popular_queries?.buckets?.map((bucket: any) => ({
        query: bucket.key,
        count: bucket.doc_count,
      })) || [];
    } catch (error) {
      logger.error('Failed to get popular searches:', error);
      return [];
    }
  }
}

export default new ElasticsearchService();
export type { SearchQuery, SearchResult, MentorDocument, SessionDocument, ContentDocument };
