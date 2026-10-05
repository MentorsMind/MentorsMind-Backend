import { db } from "../config/database";
import { Logger } from "../utils/logger.utils";

// â”€â”€â”€ Interfaces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GroupBookingRecord {
  id: string;
  session_id: string;
  mentor_id: string;
  title: string;
  description: string | null;
  scheduled_at: Date;
  duration_minutes: number;
  max_participants: number;
  current_participants: number;
  total_amount: string;
  currency: string;
  payment_split_method: "equal" | "mentorå›ºå®š" | "custom";
  payment_splits: PaymentSplit[];
  status: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled";
  meeting_url: string | null;
  recording_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface GroupParticipant {
  id: string;
  group_booking_id: string;
  user_id: string;
  role: "mentor" | "participant";
  payment_amount: string;
  payment_status: "pending" | "paid" | "refunded" | "failed";
  payment_transaction_id: string | null;
  joined_at: Date | null;
  left_at: Date | null;
  status: "invited" | "confirmed" | "joined" | "left" | "removed";
  created_at: Date;
  updated_at: Date;
}

export interface PaymentSplit {
  userId: string;
  amount: string;
  percentage: number;
  role: "mentor" | "participant";
}

export interface CreateGroupBookingPayload {
  mentorId: string;
  title: string;
  description?: string;
  scheduledAt: Date;
  durationMinutes: number;
  maxParticipants: number;
  totalAmount: string;
  currency: string;
  paymentSplitMethod: "equal" | "mentorå›ºå®š" | "custom";
  paymentSplits?: PaymentSplit[];
  participantIds: string[];
  recordingEnabled?: boolean;
}

export interface UpdateGroupBookingPayload {
  title?: string;
  description?: string;
  scheduledAt?: Date;
  durationMinutes?: number;
  maxParticipants?: number;
  status?: GroupBookingRecord["status"];
  meetingUrl?: string;
}

// â”€â”€â”€ Model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const GroupBookingModel = {
  /**
   * Create a new group booking with participants.
   */
  async create(
    payload: CreateGroupBookingPayload,
  ): Promise<GroupBookingRecord> {
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
    } = payload;

    // Calculate payment splits if not provided
    const splits =
      paymentSplits ||
      this.calculateSplits(
        totalAmount,
        paymentSplitMethod,
        participantIds.length + 1, // +1 for mentor
      );

    const query = `
      INSERT INTO group_bookings (
        mentor_id, title, description, scheduled_at, duration_minutes,
        max_participants, current_participants, total_amount, currency,
        payment_split_method, payment_splits, status, recording_enabled
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
      RETURNING *
    `;

    const { rows } = await db.query(query, [
      mentorId,
      title,
      description || null,
      scheduledAt,
      durationMinutes,
      maxParticipants,
      participantIds.length + 1,
      totalAmount,
      currency,
      paymentSplitMethod,
      JSON.stringify(splits),
      recordingEnabled,
    ]);

    const groupBooking = rows[0] as GroupBookingRecord;

    // Add participants
    for (const participantId of participantIds) {
      const participantSplit = splits.find((s) => s.userId === participantId);
      await this.addParticipant(
        groupBooking.id,
        participantId,
        "participant",
        participantSplit?.amount || "0",
      );
    }

    return groupBooking;
  },

  /**
   * Find group booking by ID.
   */
  async findById(id: string): Promise<GroupBookingRecord | null> {
    const query = `SELECT * FROM group_bookings WHERE id = $1`;
    const { rows } = await db.query(query, [id]);
    return rows[0] || null;
  },

  /**
   * Get participants for a group booking.
   */
  async getParticipants(
    groupBookingId: string,
  ): Promise<GroupParticipant[]> {
    const query = `
      SELECT * FROM group_participants
      WHERE group_booking_id = $1
      ORDER BY created_at ASC
    `;
    const { rows } = await db.query(query, [groupBookingId]);
    return rows;
  },

  /**
   * Add a participant to a group booking.
   */
  async addParticipant(
    groupBookingId: string,
    userId: string,
    role: "mentor" | "participant" = "participant",
    paymentAmount: string = "0",
  ): Promise<GroupParticipant> {
    // Check capacity
    const booking = await this.findById(groupBookingId);
    if (!booking) {
      throw new Error(`Group booking not found: ${groupBookingId}`);
    }

    if (booking.current_participants >= booking.max_participants) {
      throw new Error("Group booking is at full capacity");
    }

    // Check for duplicate
    const existingQuery = `
      SELECT id FROM group_participants
      WHERE group_booking_id = $1 AND user_id = $2
    `;
    const { rows: existing } = await db.query(existingQuery, [
      groupBookingId,
      userId,
    ]);
    if (existing.length > 0) {
      throw new Error("User is already a participant");
    }

    const query = `
      INSERT INTO group_participants (
        group_booking_id, user_id, role, payment_amount, status
      )
      VALUES ($1, $2, $3, $4, 'confirmed')
      RETURNING *
    `;
    const { rows } = await db.query(query, [
      groupBookingId,
      userId,
      role,
      paymentAmount,
    ]);

    // Update participant count
    await db.query(
      `UPDATE group_bookings
       SET current_participants = current_participants + 1, updated_at = NOW()
       WHERE id = $1`,
      [groupBookingId],
    );

    return rows[0] as GroupParticipant;
  },

  /**
   * Remove a participant from a group booking.
   */
  async removeParticipant(
    groupBookingId: string,
    userId: string,
  ): Promise<void> {
    const query = `
      UPDATE group_participants
      SET status = 'left', left_at = NOW(), updated_at = NOW()
      WHERE group_booking_id = $1 AND user_id = $2
    `;
    await db.query(query, [groupBookingId, userId]);

    // Update participant count
    await db.query(
      `UPDATE group_bookings
       SET current_participants = GREATEST(current_participants - 1, 0), updated_at = NOW()
       WHERE id = $1`,
      [groupBookingId],
    );
  },

  /**
   * Update group booking details.
   */
  async update(
    id: string,
    payload: UpdateGroupBookingPayload,
  ): Promise<GroupBookingRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (payload.title !== undefined) {
      fields.push(`title = $${paramIndex}`);
      values.push(payload.title);
      paramIndex++;
    }
    if (payload.description !== undefined) {
      fields.push(`description = $${paramIndex}`);
      values.push(payload.description);
      paramIndex++;
    }
    if (payload.scheduledAt !== undefined) {
      fields.push(`scheduled_at = $${paramIndex}`);
      values.push(payload.scheduledAt);
      paramIndex++;
    }
    if (payload.durationMinutes !== undefined) {
      fields.push(`duration_minutes = $${paramIndex}`);
      values.push(payload.durationMinutes);
      paramIndex++;
    }
    if (payload.maxParticipants !== undefined) {
      fields.push(`max_participants = $${paramIndex}`);
      values.push(payload.maxParticipants);
      paramIndex++;
    }
    if (payload.status !== undefined) {
      fields.push(`status = $${paramIndex}`);
      values.push(payload.status);
      paramIndex++;
    }
    if (payload.meetingUrl !== undefined) {
      fields.push(`meeting_url = $${paramIndex}`);
      values.push(payload.meetingUrl);
      paramIndex++;
    }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE group_bookings
      SET ${fields.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    const { rows } = await db.query(query, values);
    return rows[0] || null;
  },

  /**
   * Update participant payment status.
   */
  async updateParticipantPayment(
    groupBookingId: string,
    userId: string,
    paymentStatus: GroupParticipant["payment_status"],
    transactionId?: string,
  ): Promise<GroupParticipant> {
    const query = `
      UPDATE group_participants
      SET payment_status = $1, payment_transaction_id = $2, updated_at = NOW()
      WHERE group_booking_id = $3 AND user_id = $4
      RETURNING *
    `;
    const { rows } = await db.query(query, [
      paymentStatus,
      transactionId || null,
      groupBookingId,
      userId,
    ]);

    if (rows.length === 0) {
      throw new Error("Participant not found");
    }

    return rows[0] as GroupParticipant;
  },

  /**
   * Get all group bookings for a user (as mentor or participant).
   */
  async getUserGroupBookings(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<GroupBookingRecord[]> {
    const query = `
      SELECT gb.*
      FROM group_bookings gb
      LEFT JOIN group_participants gp ON gp.group_booking_id = gb.id
      WHERE gb.mentor_id = $1 OR gp.user_id = $1
      GROUP BY gb.id
      ORDER BY gb.scheduled_at DESC
      LIMIT $2 OFFSET $3
    `;
    const { rows } = await db.query(query, [userId, limit, offset]);
    return rows;
  },

  /**
   * Calculate payment splits based on method.
   */
  calculateSplits(
    totalAmount: string,
    method: "equal" | "mentorå›ºå®š" | "custom",
    participantCount: number,
  ): PaymentSplit[] {
    const total = parseFloat(totalAmount);

    if (method === "equal") {
      const perPerson = total / participantCount;
      // Mentor gets platform fee deduction
      const mentorShare = perPerson * 0.85;
      const platformFee = perPerson * 0.15;

      return Array.from({ length: participantCount }, (_, i) => ({
        userId: "", // will be filled in by caller
        amount: (i === 0 ? mentorShare : perPerson - platformFee).toFixed(7),
        percentage: 100 / participantCount,
        role: i === 0 ? "mentor" : "participant",
      }));
    }

    if (method === "mentorå›ºå®š") {
      const mentorShare = total * 0.7;
      const remainingPerParticipant =
        (total - mentorShare) / (participantCount - 1);

      return Array.from({ length: participantCount }, (_, i) => ({
        userId: "",
        amount: (i === 0 ? mentorShare : remainingPerParticipant).toFixed(7),
        percentage: i === 0 ? 70 : 30 / (participantCount - 1),
        role: i === 0 ? "mentor" : "participant",
      }));
    }

    // custom - return empty, caller provides splits
    return [];
  },

  /**
   * Cancel a group booking and refund participants.
   */
  async cancel(
    groupBookingId: string,
    reason?: string,
  ): Promise<GroupBookingRecord | null> {
    const query = `
      UPDATE group_bookings
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await db.query(query, [groupBookingId]);

    // Mark all participants as needing refund
    await db.query(
      `UPDATE group_participants
       SET payment_status = 'refunded', updated_at = NOW()
       WHERE group_booking_id = $1 AND payment_status = 'paid'`,
      [groupBookingId],
    );

    if (reason) {
      logger.info({ groupBookingId, reason }, "Group booking cancelled");
    }

    return rows[0] || null;
  },
};

