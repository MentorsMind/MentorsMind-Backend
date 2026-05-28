import pool from "../config/database";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";

export interface DiscussionForum {
  id: string;
  milestoneId: string;
  title: string;
  description: string;
  isActive: boolean;
  messageCount: number;
  participantCount: number;
  lastActivity: string;
  createdAt: string;
  updatedAt: string;
}

export interface ForumMessage {
  id: string;
  forumId: string;
  userId: string;
  userName: string;
  userRole: 'student' | 'mentor';
  content: string;
  parentMessageId?: string;
  isModerated: boolean;
  likeCount: number;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  replies?: ForumMessage[];
}

export interface StudyGroup {
  id: string;
  learningPathId: string;
  name: string;
  description: string;
  maxMembers: number;
  currentMembers: number;
  isPublic: boolean;
  createdBy: string;
  createdByName: string;
  status: 'active' | 'inactive' | 'completed';
  meetingSchedule?: string;
  communicationChannel?: string;
  createdAt: string;
  updatedAt: string;
  members?: StudyGroupMember[];
}

export interface StudyGroupMember {
  id: string;
  studyGroupId: string;
  userId: string;
  userName: string;
  role: 'leader' | 'member';
  joinedAt: string;
  lastActive: string;
  contributionScore: number;
}

export interface PeerReview {
  id: string;
  milestoneId: string;
  submissionId: string;
  reviewerId: string;
  reviewerName: string;
  submitterId: string;
  submitterName: string;
  rating: number;
  feedback: string;
  criteria: PeerReviewCriteria[];
  isAnonymous: boolean;
  status: 'pending' | 'completed' | 'disputed';
  createdAt: string;
  updatedAt: string;
}

export interface PeerReviewCriteria {
  criterion: string;
  rating: number;
  feedback: string;
}

export interface CollaborativeProject {
  id: string;
  milestoneId: string;
  title: string;
  description: string;
  maxParticipants: number;
  currentParticipants: number;
  status: 'planning' | 'active' | 'review' | 'completed';
  deadline?: string;
  deliverables: string[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  participants?: ProjectParticipant[];
}

export interface ProjectParticipant {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  role: 'leader' | 'contributor';
  responsibilities: string[];
  joinedAt: string;
  contributionLevel: number;
}

export interface Leaderboard {
  type: 'milestone' | 'path' | 'global';
  period: 'week' | 'month' | 'quarter' | 'all';
  entries: LeaderboardEntry[];
  lastUpdated: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  userName: string;
  score: number;
  achievements: string[];
  streakDays: number;
  completedMilestones: number;
  helpfulReviews: number;
}

export const CollaborativeLearningService = {
  /**
   * Create discussion forum for a milestone
   */
  async createMilestoneForum(
    milestoneId: string,
    creatorId: string,
    forumData: {
      title?: string;
      description?: string;
    }
  ): Promise<DiscussionForum> {
    // Verify milestone exists and user has access
    const { rows: milestoneRows } = await pool.query(
      `SELECT m.title, lp.mentor_id, pe.student_id
       FROM milestones m
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       LEFT JOIN path_enrollments pe ON lp.id = pe.learning_path_id AND pe.student_id = $2
       WHERE m.id = $1`,
      [milestoneId, creatorId]
    );

    if (milestoneRows.length === 0) {
      throw createError("Milestone not found or access denied", 404);
    }

    const milestone = milestoneRows[0];
    
    // Check if user is mentor or enrolled student
    if (milestone.mentor_id !== creatorId && milestone.student_id !== creatorId) {
      throw createError("Access denied to create forum for this milestone", 403);
    }

    // Check if forum already exists
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM milestone_forums WHERE milestone_id = $1`,
      [milestoneId]
    );

    if (existingRows.length > 0) {
      throw createError("Forum already exists for this milestone", 409);
    }

    // Create forum
    const { rows } = await pool.query<DiscussionForum>(
      `INSERT INTO milestone_forums (milestone_id, title, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING 
         id, milestone_id as "milestoneId", title, description, is_active as "isActive",
         message_count as "messageCount", participant_count as "participantCount",
         last_activity as "lastActivity", created_at as "createdAt", updated_at as "updatedAt"`,
      [
        milestoneId,
        forumData.title || `${milestone.title} Discussion`,
        forumData.description || `Discussion forum for ${milestone.title} milestone`,
        creatorId
      ]
    );

    const forum = rows[0];

    logger.info("Milestone forum created", {
      forumId: forum.id,
      milestoneId,
      creatorId
    });

    return forum;
  },

  /**
   * Post message to forum
   */
  async postForumMessage(
    forumId: string,
    userId: string,
    messageData: {
      content: string;
      parentMessageId?: string;
    }
  ): Promise<ForumMessage> {
    // Verify forum exists and user has access
    const { rows: forumRows } = await pool.query(
      `SELECT mf.*, m.learning_path_id, lp.mentor_id, pe.student_id
       FROM milestone_forums mf
       JOIN milestones m ON mf.milestone_id = m.id
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       LEFT JOIN path_enrollments pe ON lp.id = pe.learning_path_id AND pe.student_id = $2
       WHERE mf.id = $1 AND mf.is_active = true`,
      [forumId, userId]
    );

    if (forumRows.length === 0) {
      throw createError("Forum not found or access denied", 404);
    }

    const forum = forumRows[0];
    
    // Check if user is mentor or enrolled student
    if (forum.mentor_id !== userId && forum.student_id !== userId) {
      throw createError("Access denied to post in this forum", 403);
    }

    // Get user details
    const { rows: userRows } = await pool.query(
      `SELECT first_name, last_name, role FROM users WHERE id = $1`,
      [userId]
    );

    if (userRows.length === 0) {
      throw createError("User not found", 404);
    }

    const user = userRows[0];

    // Create message
    const { rows } = await pool.query<ForumMessage>(
      `INSERT INTO forum_messages (forum_id, user_id, content, parent_message_id)
       VALUES ($1, $2, $3, $4)
       RETURNING 
         id, forum_id as "forumId", user_id as "userId", content,
         parent_message_id as "parentMessageId", is_moderated as "isModerated",
         like_count as "likeCount", reply_count as "replyCount",
         created_at as "createdAt", updated_at as "updatedAt"`,
      [forumId, userId, messageData.content, messageData.parentMessageId]
    );

    const message = rows[0];
    message.userName = `${user.first_name} ${user.last_name}`;
    message.userRole = user.role === 'mentor' ? 'mentor' : 'student';

    // Update forum statistics
    await pool.query(
      `UPDATE milestone_forums 
       SET message_count = message_count + 1, 
           last_activity = NOW(),
           participant_count = (
             SELECT COUNT(DISTINCT user_id) 
             FROM forum_messages 
             WHERE forum_id = $1
           )
       WHERE id = $1`,
      [forumId]
    );

    // Update parent message reply count if this is a reply
    if (messageData.parentMessageId) {
      await pool.query(
        `UPDATE forum_messages 
         SET reply_count = reply_count + 1 
         WHERE id = $1`,
        [messageData.parentMessageId]
      );
    }

    logger.info("Forum message posted", {
      messageId: message.id,
      forumId,
      userId,
      isReply: !!messageData.parentMessageId
    });

    return message;
  },

  /**
   * Get forum messages with pagination
   */
  async getForumMessages(
    forumId: string,
    userId: string,
    options?: {
      page?: number;
      limit?: number;
      includeReplies?: boolean;
    }
  ): Promise<{ messages: ForumMessage[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    // Verify forum access
    const { rows: accessRows } = await pool.query(
      `SELECT mf.id
       FROM milestone_forums mf
       JOIN milestones m ON mf.milestone_id = m.id
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       LEFT JOIN path_enrollments pe ON lp.id = pe.learning_path_id AND pe.student_id = $2
       WHERE mf.id = $1 AND (lp.mentor_id = $2 OR pe.student_id = $2)`,
      [forumId, userId]
    );

    if (accessRows.length === 0) {
      throw createError("Forum not found or access denied", 404);
    }

    // Get top-level messages
    const { rows: messages } = await pool.query(
      `SELECT 
         fm.id, fm.forum_id as "forumId", fm.user_id as "userId", fm.content,
         fm.parent_message_id as "parentMessageId", fm.is_moderated as "isModerated",
         fm.like_count as "likeCount", fm.reply_count as "replyCount",
         fm.created_at as "createdAt", fm.updated_at as "updatedAt",
         u.first_name || ' ' || u.last_name as "userName",
         CASE WHEN u.role = 'mentor' THEN 'mentor' ELSE 'student' END as "userRole"
       FROM forum_messages fm
       JOIN users u ON fm.user_id = u.id
       WHERE fm.forum_id = $1 AND fm.parent_message_id IS NULL
       ORDER BY fm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [forumId, limit, offset]
    );

    // Get replies if requested
    if (options?.includeReplies) {
      for (const message of messages) {
        const { rows: replies } = await pool.query(
          `SELECT 
             fm.id, fm.forum_id as "forumId", fm.user_id as "userId", fm.content,
             fm.parent_message_id as "parentMessageId", fm.is_moderated as "isModerated",
             fm.like_count as "likeCount", fm.reply_count as "replyCount",
             fm.created_at as "createdAt", fm.updated_at as "updatedAt",
             u.first_name || ' ' || u.last_name as "userName",
             CASE WHEN u.role = 'mentor' THEN 'mentor' ELSE 'student' END as "userRole"
           FROM forum_messages fm
           JOIN users u ON fm.user_id = u.id
           WHERE fm.parent_message_id = $1
           ORDER BY fm.created_at ASC`,
          [message.id]
        );
        
        message.replies = replies;
      }
    }

    // Get total count
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM forum_messages WHERE forum_id = $1 AND parent_message_id IS NULL`,
      [forumId]
    );

    return {
      messages,
      total: parseInt(countRows[0].total)
    };
  },

  /**
   * Create study group for learning path
   */
  async createStudyGroup(
    learningPathId: string,
    creatorId: string,
    groupData: {
      name: string;
      description: string;
      maxMembers?: number;
      isPublic?: boolean;
      meetingSchedule?: string;
      communicationChannel?: string;
    }
  ): Promise<StudyGroup> {
    // Verify learning path exists and user is enrolled
    const { rows: pathRows } = await pool.query(
      `SELECT lp.title, pe.student_id
       FROM learning_paths lp
       JOIN path_enrollments pe ON lp.id = pe.learning_path_id
       WHERE lp.id = $1 AND pe.student_id = $2 AND pe.status = 'active'`,
      [learningPathId, creatorId]
    );

    if (pathRows.length === 0) {
      throw createError("Learning path not found or user not enrolled", 404);
    }

    // Get creator name
    const { rows: userRows } = await pool.query(
      `SELECT first_name, last_name FROM users WHERE id = $1`,
      [creatorId]
    );

    const creatorName = `${userRows[0].first_name} ${userRows[0].last_name}`;

    // Create study group
    const { rows } = await pool.query<StudyGroup>(
      `INSERT INTO study_groups (
         learning_path_id, name, description, max_members, is_public,
         meeting_schedule, communication_channel, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING 
         id, learning_path_id as "learningPathId", name, description,
         max_members as "maxMembers", current_members as "currentMembers",
         is_public as "isPublic", created_by as "createdBy", status,
         meeting_schedule as "meetingSchedule", communication_channel as "communicationChannel",
         created_at as "createdAt", updated_at as "updatedAt"`,
      [
        learningPathId,
        groupData.name,
        groupData.description,
        groupData.maxMembers || 10,
        groupData.isPublic !== false,
        groupData.meetingSchedule,
        groupData.communicationChannel,
        creatorId
      ]
    );

    const studyGroup = rows[0];
    studyGroup.createdByName = creatorName;

    // Add creator as group leader
    await pool.query(
      `INSERT INTO study_group_members (study_group_id, user_id, role)
       VALUES ($1, $2, 'leader')`,
      [studyGroup.id, creatorId]
    );

    // Update member count
    await pool.query(
      `UPDATE study_groups SET current_members = 1 WHERE id = $1`,
      [studyGroup.id]
    );

    logger.info("Study group created", {
      studyGroupId: studyGroup.id,
      learningPathId,
      creatorId
    });

    return studyGroup;
  },

  /**
   * Join study group
   */
  async joinStudyGroup(studyGroupId: string, userId: string): Promise<StudyGroupMember> {
    // Verify study group exists and user can join
    const { rows: groupRows } = await pool.query(
      `SELECT sg.*, lp.id as path_id, pe.student_id
       FROM study_groups sg
       JOIN learning_paths lp ON sg.learning_path_id = lp.id
       LEFT JOIN path_enrollments pe ON lp.id = pe.learning_path_id AND pe.student_id = $2
       WHERE sg.id = $1 AND sg.status = 'active'`,
      [studyGroupId, userId]
    );

    if (groupRows.length === 0) {
      throw createError("Study group not found or access denied", 404);
    }

    const group = groupRows[0];

    // Check if user is enrolled in the learning path
    if (!group.student_id) {
      throw createError("Must be enrolled in learning path to join study group", 403);
    }

    // Check if group is full
    if (group.current_members >= group.max_members) {
      throw createError("Study group is full", 400);
    }

    // Check if user is already a member
    const { rows: memberRows } = await pool.query(
      `SELECT id FROM study_group_members WHERE study_group_id = $1 AND user_id = $2`,
      [studyGroupId, userId]
    );

    if (memberRows.length > 0) {
      throw createError("User is already a member of this study group", 409);
    }

    // Get user name
    const { rows: userRows } = await pool.query(
      `SELECT first_name, last_name FROM users WHERE id = $1`,
      [userId]
    );

    const userName = `${userRows[0].first_name} ${userRows[0].last_name}`;

    // Add member
    const { rows } = await pool.query<StudyGroupMember>(
      `INSERT INTO study_group_members (study_group_id, user_id, role)
       VALUES ($1, $2, 'member')
       RETURNING 
         id, study_group_id as "studyGroupId", user_id as "userId", role,
         joined_at as "joinedAt", last_active as "lastActive",
         contribution_score as "contributionScore"`,
      [studyGroupId, userId]
    );

    const member = rows[0];
    member.userName = userName;

    // Update group member count
    await pool.query(
      `UPDATE study_groups SET current_members = current_members + 1 WHERE id = $1`,
      [studyGroupId]
    );

    logger.info("User joined study group", {
      studyGroupId,
      userId,
      userName
    });

    return member;
  },

  /**
   * Create peer review for milestone submission
   */
  async createPeerReview(
    milestoneId: string,
    submissionId: string,
    reviewerId: string,
    reviewData: {
      rating: number;
      feedback: string;
      criteria: PeerReviewCriteria[];
      isAnonymous?: boolean;
    }
  ): Promise<PeerReview> {
    // Verify milestone and get submission details
    const { rows: submissionRows } = await pool.query(
      `SELECT ms.*, pe.student_id as submitter_id, u.first_name, u.last_name
       FROM milestone_submissions ms
       JOIN path_enrollments pe ON ms.enrollment_id = pe.id
       JOIN users u ON pe.student_id = u.id
       WHERE ms.id = $1 AND ms.milestone_id = $2`,
      [submissionId, milestoneId]
    );

    if (submissionRows.length === 0) {
      throw createError("Submission not found", 404);
    }

    const submission = submissionRows[0];

    // Verify reviewer is enrolled in same learning path
    const { rows: reviewerRows } = await pool.query(
      `SELECT pe.student_id, u.first_name, u.last_name
       FROM path_enrollments pe
       JOIN users u ON pe.student_id = u.id
       JOIN milestones m ON pe.learning_path_id = m.learning_path_id
       WHERE m.id = $1 AND pe.student_id = $2 AND pe.status = 'active'`,
      [milestoneId, reviewerId]
    );

    if (reviewerRows.length === 0) {
      throw createError("Reviewer not enrolled in learning path", 403);
    }

    const reviewer = reviewerRows[0];

    // Check if review already exists
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM peer_reviews WHERE submission_id = $1 AND reviewer_id = $2`,
      [submissionId, reviewerId]
    );

    if (existingRows.length > 0) {
      throw createError("Review already exists for this submission", 409);
    }

    // Create peer review
    const { rows } = await pool.query<PeerReview>(
      `INSERT INTO peer_reviews (
         milestone_id, submission_id, reviewer_id, submitter_id,
         rating, feedback, criteria, is_anonymous
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING 
         id, milestone_id as "milestoneId", submission_id as "submissionId",
         reviewer_id as "reviewerId", submitter_id as "submitterId",
         rating, feedback, criteria, is_anonymous as "isAnonymous", status,
         created_at as "createdAt", updated_at as "updatedAt"`,
      [
        milestoneId,
        submissionId,
        reviewerId,
        submission.submitter_id,
        reviewData.rating,
        reviewData.feedback,
        JSON.stringify(reviewData.criteria),
        reviewData.isAnonymous || false
      ]
    );

    const peerReview = rows[0];
    peerReview.reviewerName = reviewData.isAnonymous ? 'Anonymous' : `${reviewer.first_name} ${reviewer.last_name}`;
    peerReview.submitterName = `${submission.first_name} ${submission.last_name}`;

    logger.info("Peer review created", {
      reviewId: peerReview.id,
      milestoneId,
      submissionId,
      reviewerId,
      isAnonymous: reviewData.isAnonymous
    });

    return peerReview;
  },

  /**
   * Get leaderboard for learning path or milestone
   */
  async getLeaderboard(
    type: 'milestone' | 'path' | 'global',
    targetId?: string,
    period: 'week' | 'month' | 'quarter' | 'all' = 'month'
  ): Promise<Leaderboard> {
    const cacheKey = `leaderboard:${type}:${targetId || 'global'}:${period}`;
    
    // Try cache first
    const cached = await CacheService.get<Leaderboard>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    let query = '';
    let params: any[] = [];

    // Build query based on type
    switch (type) {
      case 'milestone':
        query = `
          SELECT 
            u.id as user_id,
            u.first_name || ' ' || u.last_name as user_name,
            COUNT(mp.id) as completed_milestones,
            AVG(mp.progress_percentage) as avg_progress,
            COUNT(pr.id) as helpful_reviews,
            COALESCE(MAX(mp.completed_at) - MIN(mp.started_at), INTERVAL '0') as total_time
          FROM users u
          JOIN path_enrollments pe ON u.id = pe.student_id
          JOIN milestone_progress mp ON pe.id = mp.enrollment_id
          LEFT JOIN peer_reviews pr ON u.id = pr.reviewer_id
          WHERE mp.milestone_id = $1 AND mp.status = 'completed'
        `;
        params = [targetId];
        break;

      case 'path':
        query = `
          SELECT 
            u.id as user_id,
            u.first_name || ' ' || u.last_name as user_name,
            COUNT(mp.id) as completed_milestones,
            AVG(mp.progress_percentage) as avg_progress,
            COUNT(pr.id) as helpful_reviews,
            pe.progress_percentage as path_progress
          FROM users u
          JOIN path_enrollments pe ON u.id = pe.student_id
          JOIN milestone_progress mp ON pe.id = mp.enrollment_id
          LEFT JOIN peer_reviews pr ON u.id = pr.reviewer_id
          WHERE pe.learning_path_id = $1
        `;
        params = [targetId];
        break;

      case 'global':
        query = `
          SELECT 
            u.id as user_id,
            u.first_name || ' ' || u.last_name as user_name,
            COUNT(mp.id) as completed_milestones,
            AVG(mp.progress_percentage) as avg_progress,
            COUNT(pr.id) as helpful_reviews,
            COUNT(DISTINCT pe.learning_path_id) as paths_enrolled
          FROM users u
          JOIN path_enrollments pe ON u.id = pe.student_id
          JOIN milestone_progress mp ON pe.id = mp.enrollment_id
          LEFT JOIN peer_reviews pr ON u.id = pr.reviewer_id
        `;
        break;
    }

    // Add time filter
    if (period !== 'all') {
      const timeFilter = this.getTimeFilter(period);
      query += ` AND mp.completed_at >= $${params.length + 1}`;
      params.push(timeFilter);
    }

    query += `
      GROUP BY u.id, u.first_name, u.last_name, pe.progress_percentage
      ORDER BY completed_milestones DESC, avg_progress DESC, helpful_reviews DESC
      LIMIT 50
    `;

    const { rows } = await pool.query(query, params);

    const entries: LeaderboardEntry[] = rows.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      userName: row.user_name,
      score: this.calculateLeaderboardScore(row),
      achievements: [], // Would be populated from achievements system
      streakDays: 0, // Would be calculated from activity data
      completedMilestones: parseInt(row.completed_milestones),
      helpfulReviews: parseInt(row.helpful_reviews)
    }));

    const leaderboard: Leaderboard = {
      type,
      period,
      entries,
      lastUpdated: new Date().toISOString()
    };

    // Cache for 10 minutes
    await CacheService.set(cacheKey, leaderboard, CacheTTL.medium * 2);

    return leaderboard;
  },

  // Private helper methods

  private getTimeFilter(period: 'week' | 'month' | 'quarter'): Date {
    const now = new Date();
    switch (period) {
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'quarter':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return new Date(0);
    }
  },

  private calculateLeaderboardScore(data: any): number {
    // Simple scoring algorithm - can be made more sophisticated
    const milestoneScore = parseInt(data.completed_milestones) * 10;
    const progressScore = parseFloat(data.avg_progress) * 0.1;
    const reviewScore = parseInt(data.helpful_reviews) * 5;
    
    return Math.round(milestoneScore + progressScore + reviewScore);
  }
};