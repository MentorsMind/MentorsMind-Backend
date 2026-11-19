import { CertificationService } from "../certification.service";
import pool from "../../config/database";
import { CacheService } from "../cache.service";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
  pool: {
    query: jest.fn(),
  },
}));

jest.mock("../cache.service", () => ({
  CacheService: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

describe("CertificationService (#917)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getCertificationTypes", () => {
    it("returns cached certification types when available", async () => {
      const mockTypes = [
        { id: "type-1", name: "Stellar Developer", category: "skill" },
      ];
      (CacheService.get as jest.Mock).mockResolvedValue(mockTypes);

      const result = await CertificationService.getCertificationTypes(true);
      expect(result).toEqual(mockTypes);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("queries database and caches types when cache misses", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [
          {
            id: "type-1",
            name: "Stellar Developer",
            category: "skill",
            description: "Verified developer",
            requirements: {},
            validity_period_days: 365,
            is_required: true,
            is_active: true,
            display_order: 1,
            badge_icon: "stellar-badge.svg",
            badge_color: "#1E88E5",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await CertificationService.getCertificationTypes(true);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Stellar Developer");
      expect(CacheService.set).toHaveBeenCalled();
    });
  });

  describe("getMentorCertificationSummary", () => {
    it("computes certification level, trust score, and badge lists", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [
          {
            id: "cert-1",
            mentor_id: "mentor-123",
            certification_type_id: "type-1",
            status: "verified",
            cert_name: "Stellar Smart Contracts",
            category: "skill",
            badge_icon: "badge.svg",
            badge_color: "#4CAF50",
            verified_at: new Date(),
            expires_at: new Date(Date.now() + 864000000),
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: "cert-2",
            mentor_id: "mentor-123",
            certification_type_id: "type-2",
            status: "verified",
            cert_name: "Identity Verified",
            category: "background",
            badge_icon: "id.svg",
            badge_color: "#2196F3",
            verified_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const summary = await CertificationService.getMentorCertificationSummary("mentor-123");
      expect(summary.mentorId).toBe("mentor-123");
      expect(summary.verifiedCertifications).toBe(2);
      expect(summary.certificationLevel).toBe("intermediate");
      expect(summary.trustScore).toBeGreaterThan(0);
      expect(summary.badges).toHaveLength(2);
    });
  });

  describe("getMentorBadges and awardBadge", () => {
    it("retrieves badge list directly", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [
          {
            id: "cert-1",
            mentor_id: "mentor-123",
            certification_type_id: "type-1",
            status: "verified",
            cert_name: "Rust Developer",
            category: "skill",
            badge_icon: "rust.svg",
            badge_color: "#FF9800",
            verified_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const badges = await CertificationService.getMentorBadges("mentor-123");
      expect(badges).toHaveLength(1);
      expect(badges[0].name).toBe("Rust Developer");
    });
  });
});
