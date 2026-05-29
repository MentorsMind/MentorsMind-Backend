import axios from "axios";
import { logger } from "../utils/logger.utils";

// ─── Public interfaces (as specified in requirements) ───────────────────────────

export interface ActionItem {
  description: string;
  assigned_to?: "mentor" | "mentee" | "both";
  due_date?: string;
  completed: boolean;
}

export interface SessionSummary {
  sessionId: string;
  keyTopics: string[];
  actionItems: ActionItem[];
  learningOutcomes: string[];
  nextSteps: string[];
  aiConfidence: number;
}

export interface SessionSummaryRecord {
  id: string;
  booking_id: string;
  session_id: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  ai_provider: string | null;
  ai_model: string | null;
  ai_confidence: number | null;
  key_topics: string[];
  action_items: ActionItem[];
  learning_outcomes: string[];
  next_steps: string[];
  recommendations: string[];
  transcript_id: string | null;
  source_text: string | null;
  word_count: number | null;
  processing_time_ms: number | null;
  error_message: string | null;
  tokens_used: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface GenerateSummaryParams {
  bookingId: string;
  sessionId?: string;
  transcriptId?: string;
  transcriptText?: string;
  sessionNotes?: string;
  sessionTitle?: string;
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  model: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const AISummaryService = {
  /**
   * Generate a session summary using OpenAI GPT-4
   */
  async _generateWithOpenAI(
    sourceText: string,
    sessionTitle?: string,
  ): Promise<{
    summary: SessionSummary;
    tokensUsed: number;
    model: string;
  }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const systemPrompt = `You are an expert mentoring session analyst. Your task is to analyze mentoring session transcripts and generate comprehensive summaries.

Extract and organize the following information in JSON format:
1. keyTopics: Array of main topics discussed (3-7 topics)
2. actionItems: Array of actionable tasks with description, assigned_to (mentor/mentee/both), due_date (if mentioned), and completed (false)
3. learningOutcomes: Array of key learning points and insights (3-5 outcomes)
4. nextSteps: Array of recommended next steps for the mentee (2-4 steps)

Return ONLY valid JSON without any additional text or markdown formatting.`;

    const userPrompt = sessionTitle
      ? `Session Title: ${sessionTitle}\n\nTranscript/Notes:\n${sourceText}`
      : `Transcript/Notes:\n${sourceText}`;

    const messages: OpenAIChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const startTime = Date.now();

    const { data } = await axios.post<OpenAIChatResponse>(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4-turbo-preview",
        messages,
        temperature: 0.7,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );

    const processingTime = Date.now() - startTime;

    try {
      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No content in OpenAI response");
      }

      const parsed = JSON.parse(content);
      
      // Validate and normalize the response
      const summary: SessionSummary = {
        sessionId: "", // Will be set by caller
        keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
        actionItems: Array.isArray(parsed.actionItems) 
          ? parsed.actionItems.map((item: any) => ({
              description: item.description || "",
              assigned_to: item.assigned_to || "both",
              due_date: item.due_date || undefined,
              completed: item.completed === true,
            }))
          : [],
        learningOutcomes: Array.isArray(parsed.learningOutcomes) ? parsed.learningOutcomes : [],
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
        aiConfidence: 0.85, // Default confidence for OpenAI
      };

      return {
        summary,
        tokensUsed: data.usage.total_tokens,
        model: data.model,
      };
    } catch (parseError) {
      logger.error("AISummaryService: Failed to parse OpenAI response", {
        error: parseError,
        content: data.choices[0]?.message?.content,
      });
      throw new Error("Failed to parse AI response");
    }
  },

  /**
   * Generate a session summary using Anthropic Claude
   */
  async _generateWithAnthropic(
    sourceText: string,
    sessionTitle?: string,
  ): Promise<{
    summary: SessionSummary;
    tokensUsed: number;
    model: string;
  }> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const systemPrompt = `You are an expert mentoring session analyst. Your task is to analyze mentoring session transcripts and generate comprehensive summaries.

Extract and organize the following information in JSON format:
1. keyTopics: Array of main topics discussed (3-7 topics)
2. actionItems: Array of actionable tasks with description, assigned_to (mentor/mentee/both), due_date (if mentioned), and completed (false)
3. learningOutcomes: Array of key learning points and insights (3-5 outcomes)
4. nextSteps: Array of recommended next steps for the mentee (2-4 steps)

Return ONLY valid JSON without any additional text or markdown formatting.`;

    const userPrompt = sessionTitle
      ? `Session Title: ${sessionTitle}\n\nTranscript/Notes:\n${sourceText}`
      : `Transcript/Notes:\n${sourceText}`;

    const startTime = Date.now();

    const { data } = await axios.post<AnthropicResponse>(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-opus-20240229",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],
      },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );

    const processingTime = Date.now() - startTime;

    try {
      const content = data.content[0]?.text;
      if (!content) {
        throw new Error("No content in Anthropic response");
      }

      // Extract JSON from response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonString);
      
      // Validate and normalize the response
      const summary: SessionSummary = {
        sessionId: "", // Will be set by caller
        keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
        actionItems: Array.isArray(parsed.actionItems) 
          ? parsed.actionItems.map((item: any) => ({
              description: item.description || "",
              assigned_to: item.assigned_to || "both",
              due_date: item.due_date || undefined,
              completed: item.completed === true,
            }))
          : [],
        learningOutcomes: Array.isArray(parsed.learningOutcomes) ? parsed.learningOutcomes : [],
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
        aiConfidence: 0.88, // Default confidence for Anthropic
      };

      return {
        summary,
        tokensUsed: data.usage.input_tokens + data.usage.output_tokens,
        model: data.model,
      };
    } catch (parseError) {
      logger.error("AISummaryService: Failed to parse Anthropic response", {
        error: parseError,
        content: data.content[0]?.text,
      });
      throw new Error("Failed to parse AI response");
    }
  },

  /**
   * Main entry point for generating session summaries.
   * Provider priority: OpenAI → Anthropic
   */
  async generateSummary(params: GenerateSummaryParams): Promise<{
    summary: SessionSummary;
    provider: "openai" | "anthropic";
    model: string;
    tokensUsed: number;
    processingTimeMs: number;
  }> {
    const { transcriptText, sessionNotes, sessionTitle } = params;

    // Combine transcript and notes for analysis
    const sourceText = [transcriptText, sessionNotes]
      .filter(Boolean)
      .join("\n\n");

    if (!sourceText || sourceText.trim().length < 50) {
      throw new Error("Insufficient content for summary generation (minimum 50 characters)");
    }

    // Try OpenAI first
    try {
      const result = await this._generateWithOpenAI(sourceText, sessionTitle);
      return {
        summary: { ...result.summary, sessionId: params.sessionId || "" },
        provider: "openai",
        model: result.model,
        tokensUsed: result.tokensUsed,
        processingTimeMs: 0, // Will be set by caller
      };
    } catch (openaiError) {
      logger.warn("AISummaryService: OpenAI failed, trying Anthropic", {
        error: openaiError,
      });

      // Fallback to Anthropic
      try {
        const result = await this._generateWithAnthropic(sourceText, sessionTitle);
        return {
          summary: { ...result.summary, sessionId: params.sessionId || "" },
          provider: "anthropic",
          model: result.model,
          tokensUsed: result.tokensUsed,
          processingTimeMs: 0, // Will be set by caller
        };
      } catch (anthropicError) {
        logger.error("AISummaryService: Both AI providers failed", {
          openaiError,
          anthropicError,
        });
        throw new Error("Failed to generate summary: All AI providers unavailable");
      }
    }
  },

  /**
   * Generate personalized learning recommendations based on session summary
   */
  async generateRecommendations(
    summary: SessionSummary,
    menteeGoals?: string[],
  ): Promise<string[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Fallback to simple recommendations
      return this._generateSimpleRecommendations(summary);
    }

    try {
      const goalsText = menteeGoals && menteeGoals.length > 0
        ? `\nMentee Goals:\n${menteeGoals.join("\n")}`
        : "";

      const prompt = `Based on the following mentoring session summary, generate 3-5 personalized learning recommendations for the mentee.

Session Summary:
- Key Topics: ${summary.keyTopics.join(", ")}
- Learning Outcomes: ${summary.learningOutcomes.join(", ")}
- Action Items: ${summary.actionItems.map(a => a.description).join(", ")}
${goalsText}

Provide recommendations as a JSON array of strings. Each recommendation should be actionable and specific.
Return ONLY valid JSON without any additional text.`;

      const { data } = await axios.post<OpenAIChatResponse>(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4-turbo-preview",
          messages: [
            { role: "system", content: "You are an expert learning and development advisor." },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          response_format: { type: "json_object" },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        },
      );

      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No content in OpenAI response");
      }

      const parsed = JSON.parse(content);
      const recommendations = parsed.recommendations || parsed;
      
      return Array.isArray(recommendations) ? recommendations : [];
    } catch (error) {
      logger.warn("AISummaryService: Failed to generate AI recommendations, using fallback", {
        error,
      });
      return this._generateSimpleRecommendations(summary);
    }
  },

  /**
   * Simple fallback recommendations when AI is unavailable
   */
  _generateSimpleRecommendations(summary: SessionSummary): string[] {
    const recommendations: string[] = [];

    // Based on key topics
    if (summary.keyTopics.length > 0) {
      recommendations.push(
        `Continue exploring ${summary.keyTopics[0]} through practical exercises and real-world applications.`
      );
    }

    // Based on action items
    const incompleteItems = summary.actionItems.filter(item => !item.completed);
    if (incompleteItems.length > 0) {
      recommendations.push(
        `Focus on completing the ${incompleteItems.length} action items from this session.`
      );
    }

    // Based on learning outcomes
    if (summary.learningOutcomes.length > 0) {
      recommendations.push(
        `Build upon the key learning outcome: ${summary.learningOutcomes[0]}`
      );
    }

    // Default recommendation
    if (recommendations.length === 0) {
      recommendations.push(
        "Review the session notes and identify areas where you'd like to dive deeper in the next session."
      );
    }

    return recommendations.slice(0, 5);
  },
};
