import pool from "../config/database";
import { enqueueEmail } from "../queues/email.queue";
import { logger } from "../utils/logger.utils";

interface OnboardingNudgeCandidate {
  mentor_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  started_at: Date;
  steps_completed: string[];
  nudge_24h_sent: boolean;
  nudge_72h_sent: boolean;
  nudge_7d_sent: boolean;
}

/**
 * Fetch mentors still in_progress with their nudge state.
 * Only returns candidates whose last activity (or start) is before the given
 * age window so identical emails are never re-sent.
 */
async function fetchCandidates(): Promise<OnboardingNudgeCandidate[]> {
  const { rows } = await pool.query<OnboardingNudgeCandidate>(
    `SELECT
       mo.mentor_id,
       u.email,
       u.first_name,
       u.last_name,
       mo.started_at,
       mo.steps_completed,
       mo.nudge_24h_sent,
       mo.nudge_72h_sent,
       mo.nudge_7d_sent
     FROM mentor_onboarding mo
     JOIN users u ON u.id = mo.mentor_id
     WHERE mo.status = 'in_progress'
       AND mo.started_at IS NOT NULL`,
  );
  return rows;
}

interface SendResult {
  email: string;
  milestone: "24h" | "72h" | "7d";
  sent: boolean;
}

/**
 * Compute elapsed hours since onboarding started. A sticking point is detected
 * when the mentor has not made progress within the configured window.
 */
function elapsedHours(startedAt: Date, now: Date): number {
  return (now.getTime() - new Date(startedAt).getTime()) / (1000 * 60 * 60);
}

async function markNudgeSent(mentorId: string, column: string): Promise<void> {
  await pool.query(
    `UPDATE mentor_onboarding
     SET ${column} = TRUE, last_nudge_sent_at = NOW(), updated_at = NOW()
     WHERE mentor_id = $1`,
    [mentorId],
  );
}

export async function runOnboardingNudgeJob(): Promise<SendResult[]> {
  const candidates = await fetchCandidates();
  const now = new Date();
  const sent: SendResult[] = [];

  for (const mentor of candidates) {
    try {
      const elapsed = elapsedHours(mentor.started_at, now);
      const completedCount = (mentor.steps_completed || []).length;

      // 24h nudge: mentor has not finished onboarding within 24h of starting
      if (!mentor.nudge_24h_sent && elapsed >= 24) {
        await sendNudgeEmail(mentor, "24h", "You're almost there — finish your mentor profile", completedCount);
        await markNudgeSent(mentor.mentor_id, "nudge_24h_sent");
        sent.push({ email: mentor.email, milestone: "24h", sent: true });
      }

      // 72h nudge
      if (!mentor.nudge_72h_sent && elapsed >= 72) {
        await sendNudgeEmail(mentor, "72h", "Complete your onboarding to start mentoring", completedCount);
        await markNudgeSent(mentor.mentor_id, "nudge_72h_sent");
        sent.push({ email: mentor.email, milestone: "72h", sent: true });
      }

      // 7d nudge
      if (!mentor.nudge_7d_sent && elapsed >= 7 * 24) {
        await sendNudgeEmail(mentor, "7d", "Your mentor profile is waiting — finish it today", completedCount);
        await markNudgeSent(mentor.mentor_id, "nudge_7d_sent");
        sent.push({ email: mentor.email, milestone: "7d", sent: true });
      }
    } catch (error) {
      logger.error("[OnboardingNudge] Failed to process mentor nudge", {
        mentorId: mentor.mentor_id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  if (sent.length > 0) {
    logger.info("[OnboardingNudge] Nudge emails sent", { count: sent.length });
  }
  return sent;
}

async function sendNudgeEmail(
  mentor: OnboardingNudgeCandidate,
  milestone: "24h" | "72h" | "7d",
  subject: string,
  completedCount: number,
): Promise<void> {
  const firstName = mentor.first_name || "there";
  const remaining = Math.max(10 - completedCount, 0);

  await enqueueEmail({
    to: [mentor.email],
    subject,
    htmlContent: `
      <p>Hi ${firstName},</p>
      <p>You're <strong>${completedCount}</strong> of 10 steps into becoming a MentorMinds mentor.</p>
      <p>You still have <strong>${remaining}</strong> steps remaining to unlock bookings and start earning.</p>
      <p><a href="${process.env.MM_API_BASE || ""}/onboarding">Continue your onboarding</a> — your next step is waiting.</p>
    `,
    textContent: `Hi ${firstName}, you've completed ${completedCount}/10 onboarding steps. ${remaining} steps remain to start mentoring on MentorMinds. Continue at ${process.env.MM_API_BASE || ""}/onboarding`,
    priority: "normal",
  });
}
