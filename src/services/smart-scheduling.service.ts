import { ErrorCode } from "../errors/error-codes";
import pool from "../config/database";
import { DateTime } from "luxon";
import { createError } from "../middleware/errorHandler";
import { doTimeSlotsOverlap } from "../utils/booking-conflicts.utils";

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface SchedulingSuggestion {
  suggestedTimes: TimeSlot[];
  confidence: number;
  reasoning: string;
  factors: {
    timezoneOptimal: boolean;
    historicalSuccess: number;
    availabilityScore: number;
  };
}

interface UserSchedulingInfo {
  id: string;
  timezone: string | null;
  availability_schedule?: any;
}

export const SmartSchedulingService = {
  /**
   * Suggest optimal times for booking between a mentor and a mentee
   */
  async suggestOptimalTimes(
    mentorId: string,
    menteeId: string,
    durationMinutes: number = 60,
    startDate?: Date,
    endDate?: Date,
    excludeBookingId?: string,
  ): Promise<SchedulingSuggestion[]> {
    // 1. Fetch mentor and mentee profiles
    const { rows: users } = await pool.query<UserSchedulingInfo>(
      `SELECT id, timezone, availability_schedule FROM users WHERE id = ANY($1) AND is_active = true`,
      [[mentorId, menteeId]],
    );

    const mentor = users.find((u) => u.id === mentorId);
    const mentee = users.find((u) => u.id === menteeId);

    if (!mentor) throw createError(ErrorCode.NOT_FOUND, 404);
    if (!mentee) throw createError(ErrorCode.NOT_FOUND, 404);

    const mentorTz = mentor.timezone || "UTC";
    const menteeTz = mentee.timezone || "UTC";

    // 2. Setup dates — cap the suggestion horizon at 30 days out so we never
    // suggest times far in the future regardless of the requested endDate.
    const start = startDate
      ? DateTime.fromJSDate(startDate)
      : DateTime.now().plus({ days: 1 }).startOf("day");
    const maxEnd = start.plus({ days: 30 }).endOf("day");
    const requestedEnd = endDate
      ? DateTime.fromJSDate(endDate)
      : start.plus({ days: 7 }).endOf("day");
    const end = requestedEnd > maxEnd ? maxEnd : requestedEnd;

    // 3. Fetch mentor's existing bookings in the date range to prevent conflicts.
    // Exclude the booking being rescheduled — otherwise its own original slot
    // is treated as a conflict with itself when regenerating candidate times.
    const existingBookingsParams: any[] = [
      mentorId,
      start.toJSDate(),
      end.toJSDate(),
    ];
    let existingBookingsQuery = `SELECT id, scheduled_start, scheduled_end FROM bookings
       WHERE mentor_id = $1
         AND status NOT IN ('cancelled', 'no_show')
         AND scheduled_start >= $2
         AND scheduled_end <= $3`;
    if (excludeBookingId) {
      existingBookingsQuery += ` AND id != $4`;
      existingBookingsParams.push(excludeBookingId);
    }
    const { rows: existingBookings } = await pool.query(
      existingBookingsQuery,
      existingBookingsParams,
    );

    // 3b. Fetch the mentee's existing bookings in the same range so suggested
    // times don't conflict with the mentee's own schedule either.
    const menteeBookingsParams: any[] = [
      menteeId,
      start.toJSDate(),
      end.toJSDate(),
    ];
    let menteeBookingsQuery = `SELECT id, scheduled_start, scheduled_end FROM bookings
       WHERE mentee_id = $1
         AND status NOT IN ('cancelled', 'no_show')
         AND scheduled_start >= $2
         AND scheduled_end <= $3`;
    if (excludeBookingId) {
      menteeBookingsQuery += ` AND id != $4`;
      menteeBookingsParams.push(excludeBookingId);
    }
    const { rows: menteeBookings } = await pool.query(
      menteeBookingsQuery,
      menteeBookingsParams,
    );

    // 4. Fetch historical bookings for both to analyze patterns. Exclude the
    // booking being rescheduled so it doesn't skew its own historical score.
    const historyParams: any[] = [mentorId, menteeId];
    let historyQuery = `SELECT status, scheduled_start FROM bookings
       WHERE (mentor_id = $1 OR mentee_id = $2)
         AND status IN ('completed', 'cancelled')`;
    if (excludeBookingId) {
      historyQuery += ` AND id != $3`;
      historyParams.push(excludeBookingId);
    }
    const { rows: history } = await pool.query(historyQuery, historyParams);

    // 5. Build candidate slots (30-minute intervals)
    const suggestions: {
      slot: TimeSlot;
      timezoneOptimal: boolean;
      historicalSuccess: number;
      availabilityScore: number;
      finalScore: number;
    }[] = [];

    const schedule = mentor.availability_schedule || {};

    let current = start;
    while (current < end) {
      const slotStart = current;
      const slotEnd = current.plus({ minutes: durationMinutes });
      const jsStart = slotStart.toJSDate();
      const jsEnd = slotEnd.toJSDate();

      // Avoid slot generation outside range
      if (slotEnd > end) break;

      // Filter A: Check against the mentor's existing bookings for conflicts
      const mentorConflict = existingBookings.some((b) =>
        doTimeSlotsOverlap(
          { start: jsStart, end: jsEnd },
          {
            start: new Date(b.scheduled_start),
            end: new Date(b.scheduled_end),
          },
        ),
      );

      if (mentorConflict) {
        current = current.plus({ minutes: 30 });
        continue;
      }

      // Filter A2: Check against the mentee's existing bookings for conflicts
      const menteeConflict = menteeBookings.some((b) =>
        doTimeSlotsOverlap(
          { start: jsStart, end: jsEnd },
          {
            start: new Date(b.scheduled_start),
            end: new Date(b.scheduled_end),
          },
        ),
      );

      if (menteeConflict) {
        current = current.plus({ minutes: 30 });
        continue;
      }

      // Filter B: Check availability defined by mentor's availabilitySchedule
      const mentorTime = slotStart.setZone(mentorTz);
      const weekday = (mentorTime.weekdayLong || 'monday').toLowerCase(); // 'monday', 'tuesday', etc.
      const dayConfig = schedule[weekday];

      let isAvailable = false;
      let availabilityScore = 0.5; // Default neutral if no schedule is set

      if (dayConfig && dayConfig.enabled) {
        const timeStr = mentorTime.toFormat("HH:mm");
        const slots = dayConfig.slots || [];
        for (const s of slots) {
          if (timeStr >= s.start && timeStr < s.end) {
            isAvailable = true;
            availabilityScore = 1.0;
            break;
          }
        }
      } else if (!mentor.availability_schedule) {
        // If mentor has no schedule set at all, treat standard business hours as available
        const hour = mentorTime.hour;
        if (hour >= 9 && hour < 18) {
          isAvailable = true;
          availabilityScore = 0.8;
        }
      }

      if (!isAvailable) {
        current = current.plus({ minutes: 30 });
        continue;
      }

      // 6. Score: Timezone overlap
      const menteeTime = slotStart.setZone(menteeTz);
      const mentorHour = mentorTime.hour;
      const menteeHour = menteeTime.hour;

      let timezoneScore = 0.4;
      let timezoneOptimal = false;

      if (
        mentorHour >= 9 &&
        mentorHour < 18 &&
        menteeHour >= 9 &&
        menteeHour < 18
      ) {
        timezoneScore = 1.0;
        timezoneOptimal = true;
      } else if (
        mentorHour >= 8 &&
        mentorHour < 21 &&
        menteeHour >= 8 &&
        menteeHour < 21
      ) {
        timezoneScore = 0.8;
        timezoneOptimal = true;
      }

      // 7. Score: Historical success rate
      let historicalSuccess = 0.5; // Default score
      const hourBlock = Math.floor(mentorHour / 4); // Divide day into 6 blocks of 4 hours
      const sameDayBlockSessions = history.filter((b) => {
        const d = DateTime.fromJSDate(new Date(b.scheduled_start)).setZone(
          mentorTz,
        );
        return (
          d.weekday === mentorTime.weekday &&
          Math.floor(d.hour / 4) === hourBlock
        );
      });

      if (sameDayBlockSessions.length > 0) {
        const completed = sameDayBlockSessions.filter(
          (s) => s.status === "completed",
        ).length;
        historicalSuccess = completed / sameDayBlockSessions.length;
      }

      // 8. Calculate final weighted score
      const finalScore =
        availabilityScore * 0.4 + timezoneScore * 0.3 + historicalSuccess * 0.3;

      suggestions.push({
        slot: { start: jsStart, end: jsEnd },
        timezoneOptimal,
        historicalSuccess,
        availabilityScore,
        finalScore,
      });

      current = current.plus({ minutes: 30 });
    }

    // Sort by final score descending
    suggestions.sort((a, b) => b.finalScore - a.finalScore);

    // Group suggestions to return nice formatted SchedulingSuggestions
    const limit = 5; // Return top 5 suggestions
    const topSuggestions = suggestions.slice(0, limit);

    return topSuggestions.map((s) => {
      const confidence = Math.round(s.finalScore * 100);
      let reasoning = "";

      if (confidence >= 85) {
        reasoning = `Highly optimal time slot matching ${mentor.timezone ? "mentor's" : "standard"} working hours and fits excellent timezone overlap.`;
      } else if (confidence >= 70) {
        reasoning =
          "Good time slot with solid timezone overlap and availability match.";
      } else {
        reasoning =
          "Acceptable time slot, though it may fall slightly outside ideal working hour overlap.";
      }

      if (s.historicalSuccess > 0.7) {
        reasoning += " Backed by positive historical meeting success patterns.";
      }

      return {
        suggestedTimes: [s.slot],
        confidence,
        reasoning,
        factors: {
          timezoneOptimal: s.timezoneOptimal,
          historicalSuccess: parseFloat(s.historicalSuccess.toFixed(2)),
          availabilityScore: parseFloat(s.availabilityScore.toFixed(2)),
        },
      };
    });
  },

  /**
   * Suggest rescheduling times for an existing booking
   */
  async suggestReschedule(
    bookingId: string,
    userId: string,
  ): Promise<SchedulingSuggestion[]> {
    // Fetch original booking details
    const { rows } = await pool.query(
      `SELECT mentor_id, mentee_id, duration_minutes FROM bookings WHERE id = $1`,
      [bookingId],
    );

    const booking = rows[0];
    if (!booking) throw createError(ErrorCode.NOT_FOUND, 404);

    // Only mentor or mentee of this booking can request rescheduling suggestions
    if (booking.mentor_id !== userId && booking.mentee_id !== userId) {
      throw createError(ErrorCode.UNAUTHORIZED, 403);
    }

    // Suggest optimal times for next 7 days
    const startDate = DateTime.now()
      .plus({ days: 1 })
      .startOf("day")
      .toJSDate();
    const endDate = DateTime.now().plus({ days: 8 }).endOf("day").toJSDate();

    return this.suggestOptimalTimes(
      booking.mentor_id,
      booking.mentee_id,
      booking.duration_minutes,
      startDate,
      endDate,
      bookingId,
    );
  },
};
