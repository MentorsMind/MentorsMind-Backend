import { Logger } from "../utils/logger.utils";

export interface ParticipantEngagement {
  userId: string;
  attentionScore: number;
  speakingTime: number;
  questions: number;
  reactions: number;
  cameraOn: boolean;
  micOn: boolean;
}

export interface MeetingEngagement {
  meetingId: string;
  participants: Map<string, ParticipantEngagement>;
  overallEngagement: number;
  attentionAlerts: Array<{ userId: string; timestamp: number; reason: string }>;
}

export class EngagementTrackerService {
  private meetingEngagement: Map<string, MeetingEngagement> = new Map();

  async trackParticipant(
    meetingId: string,
    userId: string,
    metrics: Partial<ParticipantEngagement>,
  ): Promise<void> {
    let meeting = this.meetingEngagement.get(meetingId);

    if (!meeting) {
      meeting = {
        meetingId,
        participants: new Map(),
        overallEngagement: 0,
        attentionAlerts: [],
      };
      this.meetingEngagement.set(meetingId, meeting);
    }

    const existing = meeting.participants.get(userId) || {
      userId,
      attentionScore: 1,
      speakingTime: 0,
      questions: 0,
      reactions: 0,
      cameraOn: true,
      micOn: true,
    };

    meeting.participants.set(userId, { ...existing, ...metrics });
    this.calculateOverallEngagement(meeting);
  }

  async detectDisengagement(
    meetingId: string,
    userId: string,
  ): Promise<boolean> {
    const meeting = this.meetingEngagement.get(meetingId);
    if (!meeting) return false;

    const participant = meeting.participants.get(userId);
    if (!participant) return false;

    if (participant.attentionScore < 0.5) {
      meeting.attentionAlerts.push({
        userId,
        timestamp: Date.now(),
        reason: "Low attention detected",
      });
      return true;
    }

    return false;
  }

  async getEngagementReport(
    meetingId: string,
  ): Promise<MeetingEngagement | null> {
    return this.meetingEngagement.get(meetingId) || null;
  }

  private calculateOverallEngagement(meeting: MeetingEngagement): void {
    const participants = Array.from(meeting.participants.values());
    if (participants.length === 0) {
      meeting.overallEngagement = 0;
      return;
    }

    const avgEngagement =
      participants.reduce((sum, p) => sum + p.attentionScore, 0) /
      participants.length;
    meeting.overallEngagement = avgEngagement;
  }
}

export const engagementTrackerService = new EngagementTrackerService();
