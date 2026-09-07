import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { SessionTranscriptionService } from "../services/session-transcription.service";

export class SessionTranscriptionController {
  static async getTranscript(req: Request, res: Response): Promise<void> {
    const sessionId = req.params.sessionId as string;
    const transcript =
      await SessionTranscriptionService.getTranscript(sessionId);
    if (!transcript) {
      res.status(404).json({ success: false, message: "Transcript not found" });
      return;
    }
    res.json({ success: true, data: transcript });
  }

  static async saveTranscript(req: Request, res: Response): Promise<void> {
    const sessionId = req.params.sessionId as string;
    const transcript = await SessionTranscriptionService.saveTranscript({
      ...req.body,
      sessionId,
    });
    res.status(201).json({ success: true, data: transcript });
  }

  static async updateTranscript(req: Request, res: Response): Promise<void> {
    const sessionId = req.params.sessionId as string;
    await SessionTranscriptionService.updateTranscript(sessionId, req.body);
    res.json({ success: true, message: "Transcript updated" });
  }

  static async searchTranscripts(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    const { q } = req.query;
    const results = await SessionTranscriptionService.searchTranscripts(
      userId,
      q as string,
    );
    res.json({ success: true, data: results });
  }

  static async saveTranslation(req: Request, res: Response): Promise<void> {
    const sessionId = req.params.sessionId as string;
    const language = req.params.language as string;
    const { segments, summary } = req.body;
    await SessionTranscriptionService.saveTranslation(
      sessionId,
      language,
      segments,
      summary,
    );
    res.status(201).json({ success: true, message: "Translation saved" });
  }

  static async getTranslation(req: Request, res: Response): Promise<void> {
    const sessionId = req.params.sessionId as string;
    const language = req.params.language as string;
    const translation = await SessionTranscriptionService.getTranslation(
      sessionId,
      language,
    );
    if (!translation) {
      res
        .status(404)
        .json({ success: false, message: "Translation not found" });
      return;
    }
    res.json({ success: true, data: translation });
  }
}
