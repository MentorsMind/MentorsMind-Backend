import elasticsearchService from './elasticsearch.service';
import pool from '../config/database';
import { logger } from '../utils/logger';
import config from '../config';

interface MentorMapping {
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

interface SessionMapping {
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

interface ContentMapping {
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

class ElasticsearchIndexService {
  // Index mappings
  private mentorMapping = {
    properties: {
      id: { type: 'keyword' },
      name: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
          suggest: {
            type: 'completion',
            analyzer: 'simple',
          },
        },
        analyzer: 'text_analyzer',
      },
      email: { type: 'keyword' },
      expertise: {
        type: 'keyword',
      },
      hourly_rate: { type: 'float' },
      average_rating: { type: 'float' },
      bio: {
        type: 'text',
        analyzer: 'text_analyzer',
      },
      languages: { type: 'keyword' },
      availability: { type: 'keyword' },
      created_at: { type: 'date' },
      verified: { type: 'boolean' },
    },
  };

  private sessionMapping = {
    properties: {
      id: { type: 'keyword' },
      mentor_id: { type: 'keyword' },
      mentor_name: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
        },
      },
      learner_id: { type: 'keyword' },
      title: {
        type: 'text',
        analyzer: 'text_analyzer',
      },
      description: {
        type: 'text',
        analyzer: 'text_analyzer',
      },
      skills: { type: 'keyword' },
      status: { type: 'keyword' },
      scheduled_at: { type: 'date' },
      created_at: { type: 'date' },
    },
  };

  private contentMapping = {
    properties: {
      id: { type: 'keyword' },
      title: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
          suggest: {
            type: 'completion',
            analyzer: 'simple',
          },
        },
        analyzer: 'text_analyzer',
      },
      description: {
        type: 'text',
        analyzer: 'text_analyzer',
      },
      content: {
        type: 'text',
        analyzer: 'text_analyzer',
      },
      tags: { type: 'keyword' },
      category: { type: 'keyword' },
      author_id: { type: 'keyword' },
      author_name: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
        },
      },
      created_at: { type: 'date' },
    },
  };

  async initializeIndices(): Promise<void> {
    try {
      logger.info('Initializing Elasticsearch indices...');

      // Create mentors index
      await elasticsearchService.createIndex(
        config.elasticsearch.indices.mentors,
        this.mentorMapping
      );

      // Create sessions index
      await elasticsearchService.createIndex(
        config.elasticsearch.indices.sessions,
        this.sessionMapping
      );

      // Create content index
      await elasticsearchService.createIndex(
        config.elasticsearch.indices.content,
        this.contentMapping
      );

      logger.info('Elasticsearch indices initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Elasticsearch indices:', error);
      throw error;
    }
  }

  async syncMentors(): Promise<void> {
    try {
      logger.info('Syncing mentors to Elasticsearch...');

      const query = `
        SELECT 
          id, 
          name, 
          email, 
          expertise, 
          hourly_rate, 
          COALESCE(average_rating, 0) as average_rating,
          bio, 
          languages, 
          availability,
          created_at,
          verified
        FROM users 
        WHERE role = 'mentor'
      `;

      const result = await pool.query(query);
      const mentors = result.rows;

      const documents = mentors.map((mentor: any) => ({
        id: mentor.id,
        doc: {
          id: mentor.id,
          name: mentor.name,
          email: mentor.email,
          expertise: mentor.expertise || [],
          hourly_rate: mentor.hourly_rate || 0,
          average_rating: parseFloat(mentor.average_rating) || 0,
          bio: mentor.bio || '',
          languages: mentor.languages || [],
          availability: mentor.availability || 'unknown',
          created_at: mentor.created_at,
          verified: mentor.verified || false,
        },
      }));

      await elasticsearchService.bulkIndex(
        elasticsearchService['config'].elasticsearch.indices.mentors,
        documents
      );

      logger.info(`Synced ${mentors.length} mentors to Elasticsearch`);
    } catch (error) {
      logger.error('Failed to sync mentors to Elasticsearch:', error);
      throw error;
    }
  }

  async syncSessions(): Promise<void> {
    try {
      logger.info('Syncing sessions to Elasticsearch...');

      const query = `
        SELECT 
          s.id,
          s.mentor_id,
          m.name as mentor_name,
          s.learner_id,
          s.title,
          s.description,
          s.skills,
          s.status,
          s.scheduled_at,
          s.created_at
        FROM bookings s
        JOIN users m ON s.mentor_id = m.id
      `;

      const result = await pool.query(query);
      const sessions = result.rows;

      const documents = sessions.map((session: any) => ({
        id: session.id,
        doc: {
          id: session.id,
          mentor_id: session.mentor_id,
          mentor_name: session.mentor_name,
          learner_id: session.learner_id,
          title: session.title || '',
          description: session.description || '',
          skills: session.skills || [],
          status: session.status,
          scheduled_at: session.scheduled_at,
          created_at: session.created_at,
        },
      }));

      await elasticsearchService.bulkIndex(
        config.elasticsearch.indices.sessions,
        documents
      );

      logger.info(`Synced ${sessions.length} sessions to Elasticsearch`);
    } catch (error) {
      logger.error('Failed to sync sessions to Elasticsearch:', error);
      throw error;
    }
  }

  async syncContent(): Promise<void> {
    try {
      logger.info('Syncing content to Elasticsearch...');

      // Check if content table exists
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'content'
        )
      `);

      if (!tableCheck.rows[0].exists) {
        logger.info('Content table does not exist, skipping content sync');
        return;
      }

      const query = `
        SELECT 
          id,
          title,
          description,
          content,
          tags,
          category,
          author_id,
          author_name,
          created_at
        FROM content
      `;

      const result = await pool.query(query);
      const contentItems = result.rows;

      const documents = contentItems.map((item: any) => ({
        id: item.id,
        doc: {
          id: item.id,
          title: item.title || '',
          description: item.description || '',
          content: item.content || '',
          tags: item.tags || [],
          category: item.category || '',
          author_id: item.author_id,
          author_name: item.author_name || '',
          created_at: item.created_at,
        },
      }));

      await elasticsearchService.bulkIndex(
        config.elasticsearch.indices.content,
        documents
      );

      logger.info(`Synced ${contentItems.length} content items to Elasticsearch`);
    } catch (error) {
      logger.error('Failed to sync content to Elasticsearch:', error);
      throw error;
    }
  }

  async syncAll(): Promise<void> {
    try {
      await this.initializeIndices();
      await this.syncMentors();
      await this.syncSessions();
      await this.syncContent();
      logger.info('All data synced to Elasticsearch successfully');
    } catch (error) {
      logger.error('Failed to sync all data to Elasticsearch:', error);
      throw error;
    }
  }

  async indexMentor(mentorId: string): Promise<void> {
    try {
      const query = `
        SELECT 
          id, 
          name, 
          email, 
          expertise, 
          hourly_rate, 
          COALESCE(average_rating, 0) as average_rating,
          bio, 
          languages, 
          availability,
          created_at,
          verified
        FROM users 
        WHERE id = $1 AND role = 'mentor'
      `;

      const result = await pool.query(query, [mentorId]);
      
      if (result.rows.length === 0) {
        logger.warn(`Mentor ${mentorId} not found`);
        return;
      }

      const mentor = result.rows[0];

      await elasticsearchService.indexDocument(
        elasticsearchService['config'].elasticsearch.indices.mentors,
        mentorId,
        {
          id: mentor.id,
          name: mentor.name,
          email: mentor.email,
          expertise: mentor.expertise || [],
          hourly_rate: mentor.hourly_rate || 0,
          average_rating: parseFloat(mentor.average_rating) || 0,
          bio: mentor.bio || '',
          languages: mentor.languages || [],
          availability: mentor.availability || 'unknown',
          created_at: mentor.created_at,
          verified: mentor.verified || false,
        }
      );

      logger.info(`Indexed mentor ${mentorId}`);
    } catch (error) {
      logger.error(`Failed to index mentor ${mentorId}:`, error);
      throw error;
    }
  }

  async deleteMentor(mentorId: string): Promise<void> {
    try {
      await elasticsearchService.deleteDocument(
        config.elasticsearch.indices.mentors,
        mentorId
      );
      logger.info(`Deleted mentor ${mentorId} from Elasticsearch`);
    } catch (error) {
      logger.error(`Failed to delete mentor ${mentorId} from Elasticsearch:`, error);
      throw error;
    }
  }

  async indexSession(sessionId: string): Promise<void> {
    try {
      const query = `
        SELECT 
          s.id,
          s.mentor_id,
          m.name as mentor_name,
          s.learner_id,
          s.title,
          s.description,
          s.skills,
          s.status,
          s.scheduled_at,
          s.created_at
        FROM bookings s
        JOIN users m ON s.mentor_id = m.id
        WHERE s.id = $1
      `;

      const result = await pool.query(query, [sessionId]);
      
      if (result.rows.length === 0) {
        logger.warn(`Session ${sessionId} not found`);
        return;
      }

      const session = result.rows[0];

      await elasticsearchService.indexDocument(
        elasticsearchService['config'].elasticsearch.indices.sessions,
        sessionId,
        {
          id: session.id,
          mentor_id: session.mentor_id,
          mentor_name: session.mentor_name,
          learner_id: session.learner_id,
          title: session.title || '',
          description: session.description || '',
          skills: session.skills || [],
          status: session.status,
          scheduled_at: session.scheduled_at,
          created_at: session.created_at,
        }
      );

      logger.info(`Indexed session ${sessionId}`);
    } catch (error) {
      logger.error(`Failed to index session ${sessionId}:`, error);
      throw error;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await elasticsearchService.deleteDocument(
        config.elasticsearch.indices.sessions,
        sessionId
      );
      logger.info(`Deleted session ${sessionId} from Elasticsearch`);
    } catch (error) {
      logger.error(`Failed to delete session ${sessionId} from Elasticsearch:`, error);
      throw error;
    }
  }
}

export default new ElasticsearchIndexService();
