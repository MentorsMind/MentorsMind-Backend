import { Request, Response } from "express";
import { SessionModel } from "../models/session.model";
import { UsersService } from "../services/users.service";
import { MeetingService } from "../services/meeting.service";
import { db } from "../config/database";

export const getMeetingLink = async (req: Request, res: Response) => {
  const booking = await SessionModel.findById(req.params.id as string);
  if (!booking) {
    return res.status(404).json({ error: "Session not found" });
  }

  return res.json({
    meeting_url: booking.meeting_url,
  });
};

export const videoWebhook = async (req: Request, res: Response) => {
  const { event, room } = req.body;

  if (!room || !room.name) {
    return res.status(400).json({ error: "Invalid webhook payload: room name is required" });
  }

  const { rows } = await db.query(
    "SELECT * FROM sessions WHERE meeting_room_id = $1",
    [room.name]
  );
  const booking = rows[0];

  if (!booking) {
    return res.status(404).json({ error: "Session not found for room name" });
  }

  if (event === "session.started") {
    await SessionModel.updateStatus(booking.id, "in_progress" as any);
  }

  if (event === "session.ended") {
    await SessionModel.updateStatus(booking.id, "completed");
  }

  return res.sendStatus(200);
};

export const regenerateMeetingLink = async (req: Request, res: Response) => {
  const booking = await SessionModel.findById(req.params.id as string);
  if (!booking) {
    return res.status(404).json({ error: "Session not found" });
  }

  const [mentor, mentee] = await Promise.all([
    UsersService.findById(booking.mentor_id),
    UsersService.findById(booking.mentee_id),
  ]);

  const mentorName = mentor ? `${mentor.first_name} ${mentor.last_name}` : "Mentor";
  const menteeName = mentee ? `${mentee.first_name} ${mentee.last_name}` : "Mentee";

  const room = await MeetingService.createMeetingRoom({
    sessionId: booking.id,
    scheduledAt: booking.scheduled_at,
    durationMinutes: booking.duration_minutes,
    mentorName,
    menteeName,
  });

  await SessionModel.updateMeetingUrl(booking.id, {
    meetingUrl: room.meetingUrl,
    meetingProvider: room.provider,
    meetingRoomId: room.roomId,
    meetingExpiresAt: room.expiresAt,
  });

  return res.json({
    meeting_url: room.meetingUrl,
  });
};
