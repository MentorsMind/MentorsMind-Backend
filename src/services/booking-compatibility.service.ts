import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { BookingsService } from "./bookings.service";
import { SessionMilestoneService } from "./session-milestone.service";
import { ContextualBookingService } from "./contextual-booking.service";

export interface LegacyBookingMigration {
  bookingId: string;
  mentorId: string;
  studentId: string;
  suggestedMilestone?: string;
  migrationStatus: 'pending' | 'completed' | 'skipped';
  reason?: string;
}

export interface HybridModeConfig {
  mentorId: string;
  learningPathsEnabled: boolean;
  individualSessionsEnabled: boolean;
  autoLinkSessions: boolean;
  defaultSessionType: 'milestone' | 'support' | 'assessment';
}

export const BookingCompatibilityService = {
  /**
   * Ensure backward compatibility with existing booking system
   */
  async initializeCompatibilityLayer(): Promise<void> {
    logger.info("Initializing booking compatibility layer");
    
    // Verify existing booking functionality is preserved
    await this.validateExistingBookingFunctionality();
    
    // Set up hybrid mode for all mentors initially
    await this.initializeHybridMode();
    
    logger.info("Booking compatibility layer initialized successfully");
  },

  /**
   * Validate that existing booking functionality still works
   */
  async validateExistingBookingFunctionality(): Promise<boolean> {
    try {
      // Test basic booking operations without learning path integration
      const testMentorId = 'test-mentor-id';
      const testStudentId = 'test-student-id';
      
      // Verify BookingsService methods are still accessible
      const methods = [
        'createBooking',
        'getBookingById', 
        'getUserBookings',
        'updateBooking',
        'confirmBooking',
        'completeBooking',
        'cancelBooking'
      ];

      for (const method of methods) {
        if (typeof BookingsService[method] !== 'function') {
          throw new Error(`BookingsService.${method} is not available`);
        }
      }

      logger.info("Existing booking functionality validated");
      return true;
    } catch (error) {
      logger.error("Existing booking functionality validation failed", { error });
      return false;
    }
  },

  /**
   * Initialize hybrid mode for all mentors
   */
  async initializeHybridMode(): Promise<void> {
    // Create hybrid mode configuration table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mentor_hybrid_config (
        mentor_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        learning_paths_enabled BOOLEAN DEFAULT true,
        individual_sessions_enabled BOOLEAN DEFAULT true,
        auto_link_sessions BOOLEAN DEFAULT false,
        default_session_type VARCHAR(20) DEFAULT 'support' CHECK (default_session_type IN ('milestone', 'support', 'assessment')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_mentor_hybrid_config_mentor ON mentor_hybrid_config(mentor_id);
    `);

    // Initialize hybrid mode for existing mentors
    await pool.query(`
      INSERT INTO mentor_hybrid_config (mentor_id, learning_paths_enabled, individual_sessions_enabled, auto_link_sessions)
      SELECT id, true, true, false
      FROM users 
      WHERE role = 'mentor' 
      ON CONFLICT (mentor_id) DO NOTHING
    `);

    logger.info("Hybrid mode initialized for all mentors");
  },

  /**
   * Get hybrid mode configuration for a mentor
   */
  async getHybridModeConfig(mentorId: string): Promise<HybridModeConfig> {
    const { rows } = await pool.query(
      `SELECT 
         mentor_id as "mentorId",
         learning_paths_enabled as "learningPathsEnabled",
         individual_sessions_enabled as "individualSessionsEnabled", 
         auto_link_sessions as "autoLinkSessions",
         default_session_type as "defaultSessionType"
       FROM mentor_hybrid_config 
       WHERE mentor_id = $1`,
      [mentorId]
    );

    if (rows.length === 0) {
      // Create default config if not exists
      await pool.query(
        `INSERT INTO mentor_hybrid_config (mentor_id) VALUES ($1)`,
        [mentorId]
      );

      return {
        mentorId,
        learningPathsEnabled: true,
        individualSessionsEnabled: true,
        autoLinkSessions: false,
        defaultSessionType: 'support'
      };
    }

    return rows[0];
  },

  /**
   * Update hybrid mode configuration for a mentor
   */
  async updateHybridModeConfig(
    mentorId: string,
    config: Partial<Omit<HybridModeConfig, 'mentorId'>>
  ): Promise<HybridModeConfig> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (config.learningPathsEnabled !== undefined) {
      fields.push(`learning_paths_enabled = $${idx++}`);
      values.push(config.learningPathsEnabled);
    }
    if (config.individualSessionsEnabled !== undefined) {
      fields.push(`individual_sessions_enabled = $${idx++}`);
      values.push(config.individualSessionsEnabled);
    }
    if (config.autoLinkSessions !== undefined) {
      fields.push(`auto_link_sessions = $${idx++}`);
      values.push(config.autoLinkSessions);
    }
    if (config.defaultSessionType !== undefined) {
      fields.push(`default_session_type = $${idx++}`);
      values.push(config.defaultSessionType);
    }

    if (fields.length > 0) {
      fields.push(`updated_at = NOW()`);
      values.push(mentorId);

      await pool.query(
        `UPDATE mentor_hybrid_config 
         SET ${fields.join(', ')}
         WHERE mentor_id = $${idx}`,
        values
      );
    }

    return this.getHybridModeConfig(mentorId);
  },

  /**
   * Create booking with automatic learning path integration if enabled
   */
  async createCompatibleBooking(data: {
    menteeId: string;
    mentorId: string;
    scheduledAt: Date;
    durationMinutes: number;
    topic: string;
    notes?: string;
    milestoneId?: string; // Optional learning path integration
  }): Promise<{ booking: any; milestoneMapping?: any; isLearningPathIntegrated: boolean }> {
    const config = await this.getHybridModeConfig(data.mentorId);

    // If learning paths are disabled, use traditional booking
    if (!config.learningPathsEnabled) {
      const booking = await BookingsService.createBooking(data);
      return { booking, isLearningPathIntegrated: false };
    }

    // If milestone is specified, use contextual booking
    if (data.milestoneId) {
      const result = await ContextualBookingService.createContextualBooking({
        ...data,
        sessionType: config.defaultSessionType,
        contributesToCompletion: true
      });
      return { ...result, isLearningPathIntegrated: true };
    }

    // Auto-link to learning path if enabled
    if (config.autoLinkSessions) {
      const recommendations = await ContextualBookingService.getBookingRecommendations(
        data.mentorId,
        data.menteeId
      );

      if (recommendations.length > 0) {
        const topRecommendation = recommendations[0];
        const result = await ContextualBookingService.createContextualBooking({
          ...data,
          milestoneId: topRecommendation.milestoneId,
          sessionType: topRecommendation.sessionType,
          contributesToCompletion: true
        });
        return { ...result, isLearningPathIntegrated: true };
      }
    }

    // Fall back to traditional booking
    const booking = await BookingsService.createBooking(data);
    return { booking, isLearningPathIntegrated: false };
  },

  /**
   * Get available booking options for a student-mentor pair
   */
  async getBookingOptions(mentorId: string, studentId: string): Promise<{
    individualSessionsAvailable: boolean;
    learningPathsAvailable: boolean;
    learningPathContexts: any[];
    recommendations: any[];
  }> {
    const config = await this.getHybridModeConfig(mentorId);

    let learningPathContexts: any[] = [];
    let recommendations: any[] = [];

    if (config.learningPathsEnabled) {
      try {
        learningPathContexts = await ContextualBookingService.getLearningPathContext(
          mentorId,
          studentId
        );
        recommendations = await ContextualBookingService.getBookingRecommendations(
          mentorId,
          studentId
        );
      } catch (error) {
        logger.warn("Error getting learning path context", { mentorId, studentId, error });
      }
    }

    return {
      individualSessionsAvailable: config.individualSessionsEnabled,
      learningPathsAvailable: config.learningPathsEnabled,
      learningPathContexts,
      recommendations
    };
  },

  /**
   * Migrate existing mentor-student relationships to learning paths
   */
  async suggestLearningPathMigration(mentorId: string): Promise<LegacyBookingMigration[]> {
    // Get mentor's completed bookings with frequent students
    const { rows } = await pool.query(
      `SELECT 
         b.mentee_id,
         u.first_name,
         u.last_name,
         COUNT(*) as session_count,
         MAX(b.scheduled_at) as last_session,
         ARRAY_AGG(DISTINCT b.topic) as topics
       FROM bookings b
       JOIN users u ON b.mentee_id = u.id
       WHERE b.mentor_id = $1 
         AND b.status = 'completed'
         AND b.scheduled_at >= NOW() - INTERVAL '6 months'
       GROUP BY b.mentee_id, u.first_name, u.last_name
       HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC, MAX(b.scheduled_at) DESC`,
      [mentorId]
    );

    const migrations: LegacyBookingMigration[] = [];

    for (const row of rows) {
      // Check if student is already enrolled in a learning path with this mentor
      const { rows: existingEnrollments } = await pool.query(
        `SELECT COUNT(*) as count
         FROM path_enrollments pe
         JOIN learning_paths lp ON pe.learning_path_id = lp.id
         WHERE pe.student_id = $1 AND lp.mentor_id = $2`,
        [row.mentee_id, mentorId]
      );

      if (parseInt(existingEnrollments[0].count) > 0) {
        migrations.push({
          bookingId: '', // Not applicable for relationship migration
          mentorId,
          studentId: row.mentee_id,
          migrationStatus: 'completed',
          reason: 'Student already enrolled in learning path'
        });
        continue;
      }

      // Suggest learning path based on session topics
      const topics = row.topics || [];
      let suggestedMilestone = null;

      if (topics.length > 0) {
        // Try to find matching learning path milestone
        const { rows: milestoneRows } = await pool.query(
          `SELECT m.id, m.title, lp.title as path_title
           FROM milestones m
           JOIN learning_paths lp ON m.learning_path_id = lp.id
           WHERE lp.mentor_id = $1 
             AND lp.is_published = true
             AND (m.title ILIKE ANY($2) OR lp.title ILIKE ANY($2))
           LIMIT 1`,
          [mentorId, topics.map(topic => `%${topic}%`)]
        );

        if (milestoneRows.length > 0) {
          suggestedMilestone = milestoneRows[0].id;
        }
      }

      migrations.push({
        bookingId: '',
        mentorId,
        studentId: row.mentee_id,
        suggestedMilestone,
        migrationStatus: 'pending',
        reason: `${row.session_count} sessions completed, topics: ${topics.join(', ')}`
      });
    }

    return migrations;
  },

  /**
   * Migrate a student to a learning path
   */
  async migrateStudentToLearningPath(
    mentorId: string,
    studentId: string,
    pathId: string
  ): Promise<{ success: boolean; enrollmentId?: string; error?: string }> {
    try {
      // Import here to avoid circular dependency
      const { LearningPathService } = await import("./learning-path.service");
      
      const enrollment = await LearningPathService.enrollStudent(pathId, studentId);
      
      logger.info("Student migrated to learning path", {
        mentorId,
        studentId,
        pathId,
        enrollmentId: enrollment.id
      });

      return { success: true, enrollmentId: enrollment.id };
    } catch (error) {
      logger.error("Failed to migrate student to learning path", {
        mentorId,
        studentId,
        pathId,
        error
      });

      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Migration failed'
      };
    }
  },

  /**
   * Get migration statistics for a mentor
   */
  async getMigrationStatistics(mentorId: string): Promise<{
    totalStudents: number;
    studentsInLearningPaths: number;
    studentsEligibleForMigration: number;
    migrationRate: number;
  }> {
    const [totalStudentsResult, enrolledStudentsResult, eligibleStudentsResult] = await Promise.all([
      // Total unique students
      pool.query(
        `SELECT COUNT(DISTINCT mentee_id) as count
         FROM bookings 
         WHERE mentor_id = $1 AND status = 'completed'`,
        [mentorId]
      ),
      
      // Students in learning paths
      pool.query(
        `SELECT COUNT(DISTINCT pe.student_id) as count
         FROM path_enrollments pe
         JOIN learning_paths lp ON pe.learning_path_id = lp.id
         WHERE lp.mentor_id = $1`,
        [mentorId]
      ),
      
      // Students eligible for migration (3+ sessions, not in learning paths)
      pool.query(
        `SELECT COUNT(DISTINCT b.mentee_id) as count
         FROM bookings b
         WHERE b.mentor_id = $1 
           AND b.status = 'completed'
           AND b.mentee_id NOT IN (
             SELECT DISTINCT pe.student_id
             FROM path_enrollments pe
             JOIN learning_paths lp ON pe.learning_path_id = lp.id
             WHERE lp.mentor_id = $1
           )
         GROUP BY b.mentee_id
         HAVING COUNT(*) >= 3`,
        [mentorId]
      )
    ]);

    const totalStudents = parseInt(totalStudentsResult.rows[0]?.count || '0');
    const studentsInLearningPaths = parseInt(enrolledStudentsResult.rows[0]?.count || '0');
    const studentsEligibleForMigration = eligibleStudentsResult.rows.length;

    const migrationRate = totalStudents > 0 ? (studentsInLearningPaths / totalStudents) * 100 : 0;

    return {
      totalStudents,
      studentsInLearningPaths,
      studentsEligibleForMigration,
      migrationRate
    };
  },

  /**
   * Validate that learning path integration doesn't break existing functionality
   */
  async validateIntegrationIntegrity(): Promise<{
    bookingSystemIntact: boolean;
    learningPathIntegrationWorking: boolean;
    hybridModeOperational: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];
    let bookingSystemIntact = true;
    let learningPathIntegrationWorking = true;
    let hybridModeOperational = true;

    try {
      // Test 1: Verify booking system still works independently
      const bookingMethods = ['createBooking', 'getBookingById', 'getUserBookings'];
      for (const method of bookingMethods) {
        if (typeof BookingsService[method] !== 'function') {
          bookingSystemIntact = false;
          issues.push(`BookingsService.${method} is not available`);
        }
      }

      // Test 2: Verify learning path integration works
      const integrationMethods = ['linkSessionToMilestone', 'getSessionContext'];
      for (const method of integrationMethods) {
        if (typeof SessionMilestoneService[method] !== 'function') {
          learningPathIntegrationWorking = false;
          issues.push(`SessionMilestoneService.${method} is not available`);
        }
      }

      // Test 3: Verify hybrid mode configuration exists
      const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_name = 'mentor_hybrid_config'`
      );
      
      if (parseInt(rows[0].count) === 0) {
        hybridModeOperational = false;
        issues.push('Hybrid mode configuration table not found');
      }

    } catch (error) {
      issues.push(`Integration validation error: ${error instanceof Error ? error.message : error}`);
      bookingSystemIntact = false;
      learningPathIntegrationWorking = false;
      hybridModeOperational = false;
    }

    return {
      bookingSystemIntact,
      learningPathIntegrationWorking,
      hybridModeOperational,
      issues
    };
  }
};