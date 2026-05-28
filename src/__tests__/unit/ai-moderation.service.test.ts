import axios from "axios";
import {
  AIModerationService,
  ModerationResult,
} from "../../services/ai-moderation.service";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

// Helper — build a fake OpenAI moderation response
function openAIResponse(scores: Record<string, number>, flagged = false) {
  const categories: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(scores)) {
    categories[k] = v >= 0.5;
  }
  return {
    data: {
      id: "modr-test",
      model: "text-moderation-latest",
      results: [{ flagged, categories, category_scores: scores }],
    },
  };
}

// Helper — build a fake Perspective API response
function perspectiveResponse(scores: Record<string, number>) {
  const attributeScores: Record<
    string,
    { summaryScore: { value: number; type: string } }
  > = {};
  for (const [attr, value] of Object.entries(scores)) {
    attributeScores[attr] = { summaryScore: { value, type: "PROBABILITY" } };
  }
  return { data: { attributeScores } };
}

describe("AIModerationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set API keys so the service attempts external calls
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.PERSPECTIVE_API_KEY = "test-perspective-key";
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.PERSPECTIVE_API_KEY;
  });

  // ─── scan: OpenAI path ────────────────────────────────────────────────────

  describe("scan() via OpenAI", () => {
    it("returns 'allow' action for clean content", async () => {
      mockAxios.post.mockResolvedValueOnce(
        openAIResponse({
          hate: 0.001,
          harassment: 0.002,
          "sexual/minors": 0.0001,
        }),
      );

      const result = await AIModerationService.scan(
        "id-1",
        "message",
        "Hello, how are you?",
      );

      expect(result.provider).toBe("openai");
      expect(result.action).toBe("allow");
      expect(result.severity).toBe("low");
      expect(result.contentId).toBe("id-1");
      expect(result.contentType).toBe("message");
    });

    it("returns 'review' action for medium-severity content", async () => {
      mockAxios.post.mockResolvedValueOnce(
        openAIResponse({ hate: 0.45, harassment: 0.38 }),
      );

      const result = await AIModerationService.scan(
        "id-2",
        "review",
        "Some borderline text",
      );

      expect(result.provider).toBe("openai");
      expect(result.severity).toBe("medium");
      expect(result.action).toBe("review");
    });

    it("returns 'hide' action for high-severity content", async () => {
      mockAxios.post.mockResolvedValueOnce(
        openAIResponse({ hate: 0.7, harassment: 0.65 }),
      );

      const result = await AIModerationService.scan(
        "id-3",
        "profile",
        "Hateful content here",
      );

      expect(result.provider).toBe("openai");
      expect(result.severity).toBe("high");
      expect(result.action).toBe("hide");
    });

    it("returns 'block' action for critical-severity content", async () => {
      mockAxios.post.mockResolvedValueOnce(
        openAIResponse({ "sexual/minors": 0.92, hate: 0.88 }),
      );

      const result = await AIModerationService.scan(
        "id-4",
        "message",
        "Critical violation",
      );

      expect(result.provider).toBe("openai");
      expect(result.severity).toBe("critical");
      expect(result.action).toBe("block");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("populates flags for detected categories", async () => {
      mockAxios.post.mockResolvedValueOnce(
        openAIResponse({ hate: 0.72, harassment: 0.15 }),
      );

      const result = await AIModerationService.scan(
        "id-5",
        "review",
        "Offensive text",
      );

      expect(result.flags.length).toBeGreaterThan(0);
      const hateFlag = result.flags.find((f) => f.category === "hate");
      expect(hateFlag).toBeDefined();
      expect(hateFlag!.score).toBeCloseTo(0.72);
    });
  });

  // ─── scan: Perspective fallback ───────────────────────────────────────────

  describe("scan() via Perspective fallback", () => {
    it("falls back to Perspective when OpenAI returns an error", async () => {
      // OpenAI fails
      mockAxios.post.mockRejectedValueOnce(new Error("OpenAI 500"));
      // Perspective succeeds
      mockAxios.post.mockResolvedValueOnce(
        perspectiveResponse({ TOXICITY: 0.75, INSULT: 0.6 }),
      );

      const result = await AIModerationService.scan(
        "id-6",
        "message",
        "Rude content",
      );

      expect(result.provider).toBe("perspective");
      expect(result.severity).toBe("high");
    });

    it("maps Perspective attributes to lowercase flag categories", async () => {
      mockAxios.post.mockRejectedValueOnce(new Error("OpenAI down"));
      mockAxios.post.mockResolvedValueOnce(
        perspectiveResponse({ TOXICITY: 0.55, SPAM: 0.45 }),
      );

      const result = await AIModerationService.scan(
        "id-7",
        "review",
        "Some spam",
      );

      const categories = result.flags.map((f) => f.category);
      expect(categories).toContain("toxicity");
    });
  });

  // ─── scan: heuristic fallback ─────────────────────────────────────────────

  describe("scan() heuristic fallback", () => {
    beforeEach(() => {
      // Both API keys absent → heuristic only
      delete process.env.OPENAI_API_KEY;
      delete process.env.PERSPECTIVE_API_KEY;
    });

    it("uses heuristic provider when no API keys configured", async () => {
      const result = await AIModerationService.scan(
        "id-8",
        "profile",
        "Hello there",
      );

      expect(result.provider).toBe("heuristic");
      expect(result.action).toBe("allow");
    });

    it("detects spam patterns via heuristics", async () => {
      const result = await AIModerationService.scan(
        "id-9",
        "message",
        "BUY NOW! Click here for free money make $5000 today",
      );

      expect(result.provider).toBe("heuristic");
      expect(result.flags.length).toBeGreaterThan(0);
      const categories = result.flags.map((f) => f.category);
      expect(categories).toContain("spam");
    });
  });

  // ─── edge cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns allow for empty text without calling any API", async () => {
      const result = await AIModerationService.scan("id-10", "message", "");

      expect(mockAxios.post).not.toHaveBeenCalled();
      expect(result.action).toBe("allow");
      expect(result.provider).toBe("heuristic");
    });

    it("strips HTML before scanning", async () => {
      mockAxios.post.mockResolvedValueOnce(openAIResponse({ hate: 0.01 }));

      await AIModerationService.scan(
        "id-11",
        "profile",
        "<b>Hello <script>alert(1)</script></b>",
      );

      // Verify axios was called with stripped text (no HTML)
      const calledWith = mockAxios.post.mock.calls[0][1] as { input: string };
      expect(calledWith.input).not.toContain("<");
      expect(calledWith.input).not.toContain(">");
    });
  });

  // ─── scanAndEnforce ───────────────────────────────────────────────────────

  describe("scanAndEnforce()", () => {
    it("throws 422 when content is blocked", async () => {
      mockAxios.post.mockResolvedValueOnce(
        openAIResponse({ "sexual/minors": 0.95 }),
      );

      await expect(
        AIModerationService.scanAndEnforce(
          "id-12",
          "message",
          "Critical content",
        ),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining("blocked"),
      });
    });

    it("returns result without throwing for allowed content", async () => {
      mockAxios.post.mockResolvedValueOnce(openAIResponse({ hate: 0.01 }));

      const result = await AIModerationService.scanAndEnforce(
        "id-13",
        "review",
        "Good review",
      );

      expect(result.action).toBe("allow");
    });

    it("returns result without throwing for review-action content", async () => {
      mockAxios.post.mockResolvedValueOnce(openAIResponse({ hate: 0.45 }));

      const result = await AIModerationService.scanAndEnforce(
        "id-14",
        "message",
        "Borderline text",
      );

      expect(result.action).toBe("review");
      // Should NOT throw — content is allowed through for human review
    });

    it("attaches moderationResult to thrown error", async () => {
      mockAxios.post.mockResolvedValueOnce(
        openAIResponse({ hate: 0.95, "hate/threatening": 0.91 }),
      );

      let thrownError: any;
      try {
        await AIModerationService.scanAndEnforce(
          "id-15",
          "profile",
          "Threatening content",
        );
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError.moderationResult).toBeDefined();
      expect(thrownError.moderationResult.contentId).toBe("id-15");
    });
  });
});
