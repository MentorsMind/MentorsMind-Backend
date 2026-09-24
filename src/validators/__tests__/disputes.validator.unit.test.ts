import {
  uploadEvidenceSchema,
  resolveDisputeSchema,
  mediateDisputeSchema,
} from "../disputes.validator";

describe("Disputes Validator Unit Tests", () => {
  describe("uploadEvidenceSchema", () => {
    it("should accept valid text_content and file_url", () => {
      const input = {
        body: {
          text_content: "Valid evidence text",
          file_url: "https://example.com/file.png",
        },
      };
      const result = uploadEvidenceSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject text_content exceeding 5000 characters", () => {
      const input = {
        body: {
          text_content: "a".repeat(5001),
        },
      };
      const result = uploadEvidenceSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject invalid file_url", () => {
      const input = {
        body: {
          file_url: "not-a-valid-url",
        },
      };
      const result = uploadEvidenceSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("resolveDisputeSchema", () => {
    it("should accept valid mentor_pct between 0 and 100", () => {
      const input = {
        body: {
          mentor_pct: 50,
          notes: "Resolving dispute at 50%",
        },
      };
      const result = resolveDisputeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject mentor_pct greater than 100 (e.g. 150)", () => {
      const input = {
        body: {
          mentor_pct: 150,
        },
      };
      const result = resolveDisputeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject mentor_pct less than 0 (e.g. -10)", () => {
      const input = {
        body: {
          mentor_pct: -10,
        },
      };
      const result = resolveDisputeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject notes exceeding 1000 characters", () => {
      const input = {
        body: {
          mentor_pct: 50,
          notes: "b".repeat(1001),
        },
      };
      const result = resolveDisputeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("mediateDisputeSchema", () => {
    it("should accept valid optional notes under 1000 characters", () => {
      const input = {
        body: {
          notes: "Mediation notes",
        },
      };
      const result = mediateDisputeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject notes exceeding 1000 characters", () => {
      const input = {
        body: {
          notes: "c".repeat(1001),
        },
      };
      const result = mediateDisputeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
