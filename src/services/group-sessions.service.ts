import pool from "../config/database";
import { CacheService } from "./cache.service";
import { Logger } from "../utils/logger.utils";
import { GroupBookingModel, GroupBookingRecord, GroupParticipant } from "../models/group-booking.model";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface CreateGroupSessionRequest {
  mentorId: string;
  title: string;
  description?: string;
  scheduledAt: Date;
  durationMinutes: number;
  maxParticipants: number;
  totalAmount: string;
  currency: string;
  paymentSplitMethod: "equal" | "mentor固定" | "custom";
  paymentSplits?: Array<{
    userId: string;
    amount: string;
    percentage: number;
    role: "mentor" | "participant";
  }>;
  participantIds: string[];
  topic?: string;
  notes?: string;
  recordingEnabled?: boolean;
}

export interface GroupSessionResponse {
  groupBooking: GroupBookingRecord;
  participants: GroupParticipant[];
  meetingUrl: string | null;
}

export interface PaymentSplitResult {
  userId: string;
  amount: string;
  currency: string;
  transactionId: string | null;
  status: "pending" | "completed" | "failed";
}

export interface GroupSessionMetrics {
  totalGroupSessions: number;
  completedGroupSessions: number;
  avgParticipantsPerSession: number;
  totalRevenue: number;
  avgRevenuePerSession: number;
  participantRetentionRate: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const GroupSessionsService = {
  /**
   * Create a new group session.
   */
  async createGroupSession(
    request: CreateGroupSessionRequest,
  ): Promise<GroupSessionResponse> {
    const {
      mentorId,
      title,
      description,
      scheduledAt,
      durationMinutes,
      maxParticipants,
      totalAmount,
      currency,
      paymentSplitMethod,
      paymentSplits,
      participantIds,
      recordingEnabled = true,
    } = request;

    // Validate participant count
    if (participantIds.length > maxParticipants - 1) {
      throw new Error(
        `Participant count (${participantIds.length}) exceeds available slots (${maxParticipants - 1})`,
      );
    }

    // Validate minimum participants
    if (participantIds.length < 1) {
      throw new Error("At least one participant is required");
    }

    // Validate no duplicate participants
    const uniqueParticipants = new Set(participantIds);
    if (uniqueParticipants.size !== participantIds.length) {
      throw new Error("Duplicate participants are not allowed");
    }

    // Validate mentor is not in participant list
    if (participantIds.includes(mentorId)) {
      throw new Error("Mentor cannot be a participant");
    }

    // Create group booking
    const groupBooking = await GroupBookingModel.create({
      mentorId,
      title,
      description,
      scheduledAt,
      durationMinutes,
      maxParticipants,
      totalAmount,
      currency,
      paymentSplitMethod,
      paymentSplits,
      participantIds,
      recordingEnabled,
    });

    // Get all participants including mentor
    const participants = await GroupBookingModel.getParticipants(groupBooking.id);

    // Generate meeting URL (placeholder - integrate with video service)
    const meetingUrl = `https://meet.mentorminds.io/group/${groupBooking.id}`;

    // Update meeting URL
    await GroupBookingModel.update(groupBooking.id, { meetingUrl });

    // Notify participants
    await this.notifyParticipants(groupBooking, participants, "session_created");

    logger.info(
      {
        groupBookingId: groupBooking.id,
        mentorId,
        participantCount: participantIds.length,
        totalAmount,
        currency,
      },
      "Group session created",
    );

    return {
      groupBooking: { ...groupBooking, meeting_url: meetingUrl },
      participants,
      meetingUrl,
    };
  },

  /**
   * Confirm a group booking (mentor action).
   */
  async confirmGroupSession(
    groupBookingId: string,
    mentorId: string,
  ): Promise<GroupSessionResponse> {
    const groupBooking = await GroupBookingModel.findById(groupBookingId);
    if (!groupBooking) {
      throw new Error(`Group booking not found: ${groupBookingId}`);
    }

    if (groupBooking.mentor_id !== mentorId) {
      throw new Error("Only the mentor can confirm a group session");
    }

    if (groupBooking.status !== "pending") {
      throw new Error("Group session is not in pending status");
    }

    // Check minimum participants
    if (groupBooking.current_participants < 2) {
      throw new Error("At least 2 participants are required to confirm");
    }

    const updated = await GroupBookingModel.update(groupBookingId, {
      status: "confirmed",
    });

    const participants = await GroupBookingModel.getParticipants(groupBookingId);

    await this.notifyParticipants(updated!, participants, "session_confirmed");

    return {
      groupBooking: updated!,
      participants,
      meetingUrl: groupBooking.meeting_url,
    };
  },

  /**
   * Process payment splits for a completed group session.
   */
  async processPaymentSplits(
    groupBookingId: string,
  ): Promise<PaymentSplitResult[]> {
    const groupBooking = await GroupBookingModel.findById(groupBookingId);
    if (!groupBooking) {
      throw new Error(`Group booking not found: ${groupBookingId}`);
    }

    if (groupBooking.status !== "completed") {
      throw new Error("Group session must be completed before processing payments");
    }

    const participants = await GroupBookingModel.getParticipants(groupBookingId);
    const splits = groupBooking.payment_splits as Array<{
      userId: string;
      amount: string;
      percentage: number;
      role: string;
    }>;

    const results: PaymentSplitResult[] = [];

    for (const participant of participants) {
      const split = splits.find((s) => s.userId === participant.user_id);
      if (!split) continue;

      try {
        // Record payment split in database
        const txQuery = `
          INSERT INTO payment_splits (group_booking_id, user_id, amount, currency, status)
          VALUES ($1, $2, $3, $4, 'completed')
          RETURNING id
        `;
        const { rows: txRows } = await pool.query(txQuery, [
          groupBookingId,
          participant.user_id,
          split.amount,
          groupBooking.currency,
        ]);

        const txId = txRows[0]?.id || null;

        await GroupBookingModel.updateParticipantPayment(
          groupBookingId,
          participant.user_id,
          "paid",
          txId,
        );

        results.push({
          userId: participant.user_id,
          amount: split.amount,
          currency: groupBooking.currency,
          transactionId: txId,
          status: "completed",
        });
      } catch (error) {
        await GroupBookingModel.updateParticipantPayment(
          groupBookingId,
          participant.user_id,
          "failed",
        );

        results.push({
          userId: participant.user_id,
          amount: split.amount,
          currency: groupBooking.currency,
          transactionId: null,
          status: "failed",
        });

        logger.error(
          { groupBookingId, userId: participant.user_id, error },
          "Payment split failed",
        );
      }
    }

    return results;
  },

  /**
   * Start a group session (participant joining).
   */
  async joinGroupSession(
    groupBookingId: string,
    userId: string,
  ): Promise<GroupParticipant> {
    const groupBooking = await GroupBookingModel.findById(groupBookingId);
    if (!groupBooking) {
      throw new Error(`Group booking not found: ${groupBookingId}`);
    }

    if (!["confirmed"].includes(groupBooking.status)) {
      throw new Error("Group session is not available for joining");
    }

    // Verify user is a participant
    const participants = await GroupBookingModel.getParticipants(groupBookingId);
    const participant = participants.find((p) => p.user_id === userId);
    if (!participant) {
      throw new Error("User is not a participant of this group session");
    }

    // Update joined_at
    const query = `
      UPDATE group_participants
      SET joined_at = NOW(), status = 'joined', updated_at = NOW()
      WHERE group_booking_id = $1 AND user_id = $2
      RETURNING *
    `;
    const { rows } = await pool.query(query, [groupBookingId, userId]);

    logger.info({ groupBookingId, userId }, "Participant joined group session");

    return rows[0] as GroupParticipant;
  },

  /**
   * Leave a group session.
   */
  async leaveGroupSession(
    groupBookingId: string,
    userId: string,
  ): Promise<void> {
    const groupBooking = await GroupBookingModel.findById(groupBookingId);
    if (!groupBooking) {
      throw new Error(`Group booking not found: ${groupBookingId}`);
    }

    // Mentor cannot leave
    if (groupBooking.mentor_id === userId) {
      throw new Error("Mentor cannot leave a group session");
    }

    // Check if session has started
    const scheduledTime = new Date(groupBooking.scheduled_at);
    const now = new Date();
    if (now >= scheduledTime) {
      throw new Error("Cannot leave a session that has already started");
    }

    await GroupBookingModel.removeParticipant(groupBookingId, userId);

    logger.info({ groupBookingId, userId }, "Participant left group session");
  },

  /**
   * Cancel a group session.
   */
  async cancelGroupSession(
    groupBookingId: string,
    userId: string,
    reason?: string,
  ): Promise<void> {
    const groupBooking = await GroupBookingModel.findById(groupBookingId);
    if (!groupBooking) {
      throw new Error(`Group booking not found: ${groupBookingId}`);
    }

    // Only mentor or admin can cancel
    if (groupBooking.mentor_id !== userId) {
      throw new Error("Only the mentor can cancel a group session");
    }

    if (groupBooking.status === "completed") {
      throw new Error("Cannot cancel a completed session");
    }

    // Process refunds
    if (groupBooking.status === "confirmed") {
      await this.processRefunds(groupBookingId);
    }

    await GroupBookingModel.cancel(groupBookingId, reason);

    // Notify participants
    const participants = await GroupBookingModel.getParticipants(groupBookingId);
    await this.notifyParticipants(groupBooking, participants, "session_cancelled");

    logger.info({ groupBookingId, userId, reason }, "Group session cancelled");
  },

  /**
   * Get group session details.
   */
  async getGroupSessionDetails(
    groupBookingId: string,
  ): Promise<GroupSessionResponse | null> {
    const groupBooking = await GroupBookingModel.findById(groupBookingId);
    if (!groupBooking) return null;

    const participants = await GroupBookingModel.getParticipants(groupBookingId);

    return {
      groupBooking,
      participants,
      meetingUrl: groupBooking.meeting_url,
    };
  },

  /**
   * Get group sessions for a user.
   */
  async getUserGroupSessions(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<GroupBookingRecord[]> {
    return GroupBookingModel.getUserGroupBookings(userId, limit, offset);
  },

  /**
   * Get group session metrics for a mentor.
   */
  async getMentorGroupMetrics(
    mentorId: string,
    days: number = 30,
  ): Promise<GroupSessionMetrics> {
    const query = `
      WITH group_stats AS (
        SELECT
          COUNT(*) as total_sessions,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_sessions,
          AVG(current_participants) as avg_participants,
          SUM(total_amount::numeric) as total_revenue,
          AVG(total_amount::numeric) as avg_revenue
        FROM group_bookings
        WHERE mentor_id = $1
          AND created_at >= NOW() - INTERVAL '1 day' * $2
      ),
      retention AS (
        SELECT
          COUNT(DISTINCT user_id) FILTER (WHERE status IN ('joined', 'confirmed'))::float /
            NULLIF(COUNT(DISTINCT user_id), 0) as retention_rate
        FROM group_participants gp
        JOIN group_bookings gb ON gb.id = gp.group_booking_id
        WHERE gb.mentor_id = $1
          AND gb.created_at >= NOW() - INTERVAL '1 day' * $2
      )
      SELECT
        gs.total_sessions,
        gs.completed_sessions,
        gs.avg_participants,
        gs.total_revenue,
        gs.avg_revenue,
        COALESCE(r.retention_rate, 0) as participant_retention_rate
      FROM group_stats gs
      LEFT JOIN retention r ON true
    `;
    const { rows } = await pool.query(query, [mentorId, days]);
    const row = rows[0] || {};

    return {
      totalGroupSessions: parseInt(row.total_sessions || "0"),
      completedGroupSessions: parseInt(row.completed_sessions || "0"),
      avgParticipantsPerSession: parseFloat(row.avg_participants || "0"),
      totalRevenue: parseFloat(row.total_revenue || "0"),
      avgRevenuePerSession: parseFloat(row.avg_revenue || "0"),
      participantRetentionRate: parseFloat(row.participant_retention_rate || "0"),
    };
  },

  // ─── Private helpers ───────────────────────────────────────────────────────

  async processRefunds(groupBookingId: string): Promise<void> {
    const participants = await GroupBookingModel.getParticipants(groupBookingId);

    for (const participant of participants) {
      if (participant.payment_status === "paid") {
        try {
          await GroupBookingModel.updateParticipantPayment(
            groupBookingId,
            participant.user_id,
            "refunded",
          );
        } catch (error) {
          logger.error(
            { groupBookingId, userId: participant.user_id, error },
            "Refund failed",
          );
        }
      }
    }
  },

  async notifyParticipants(
    groupBooking: GroupBookingRecord,
    participants: GroupParticipant[],
    event: string,
  ): Promise<void> {
    // Placeholder for notification integration
    logger.info(
      {
        groupBookingId: groupBooking.id,
        event,
        participantCount: participants.length,
      },
      "Group session notification sent",
    );
  },
};
