import { Logger } from "../utils/logger.utils";
import { TranscriptionSegment } from "./ai-transcription.service";

export interface ActionItem {
  id: string;
  text: string;
  assignee?: string;
  dueDate?: Date;
  priority: "low" | "medium" | "high";
  completed: boolean;
}

export interface MeetingSummary {
  meetingId: string;
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: ActionItem[];
  decisions: string[];
  nextSteps: string[];
  duration: number;
  participants: string[];
}

export class MeetingSummarizerService {
  async generateSummary(
    meetingId: string,
    transcription: TranscriptionSegment[],
  ): Promise<MeetingSummary> {
    logger.info({ meetingId }, "Generating meeting summary");

    const keyPoints = await this.extractKeyPoints(transcription);
    const actionItems = await this.extractActionItems(transcription);
    const decisions = await this.extractDecisions(transcription);

    return {
      meetingId,
      title: "Meeting Summary",
      summary: this.generateTextSummary(transcription),
      keyPoints,
      actionItems,
      decisions,
      nextSteps: [],
      duration: this.calculateDuration(transcription),
      participants: this.extractParticipants(transcription),
    };
  }

  async extractActionItems(
    transcription: TranscriptionSegment[],
  ): Promise<ActionItem[]> {
    const actionItems: ActionItem[] = [];
    const actionKeywords = [
      "will",
      "should",
      "need to",
      "must",
      "action",
      "todo",
      "task",
    ];

    for (const segment of transcription) {
      const text = segment.text.toLowerCase();
      const hasActionKeyword = actionKeywords.some((keyword) =>
        text.includes(keyword),
      );

      if (hasActionKeyword) {
        actionItems.push({
          id: Math.random().toString(36),
          text: segment.text,
          priority: "medium",
          completed: false,
        });
      }
    }

    return actionItems;
  }

  async extractDecisions(
    transcription: TranscriptionSegment[],
  ): Promise<string[]> {
    const decisions: string[] = [];
    const decisionKeywords = [
      "decided",
      "agreed",
      "conclude",
      "resolution",
      "final",
    ];

    for (const segment of transcription) {
      const text = segment.text.toLowerCase();
      const hasDecisionKeyword = decisionKeywords.some((keyword) =>
        text.includes(keyword),
      );

      if (hasDecisionKeyword) {
        decisions.push(segment.text);
      }
    }

    return decisions;
  }

  private async extractKeyPoints(
    transcription: TranscriptionSegment[],
  ): Promise<string[]> {
    // Placeholder implementation - would use NLP for actual extraction
    return transcription
      .filter((_, index) => index % 5 === 0)
      .map((segment) => segment.text)
      .slice(0, 5);
  }

  private generateTextSummary(transcription: TranscriptionSegment[]): string {
    const allText = transcription.map((s) => s.text).join(" ");
    return allText.substring(0, 500) + "...";
  }

  private calculateDuration(transcription: TranscriptionSegment[]): number {
    if (transcription.length === 0) return 0;
    const last = transcription[transcription.length - 1];
    return last.endTime;
  }

  private extractParticipants(transcription: TranscriptionSegment[]): string[] {
    const speakers = new Set(transcription.map((s) => s.speaker));
    return Array.from(speakers);
  }
}

export const meetingSummarizerService = new MeetingSummarizerService();
