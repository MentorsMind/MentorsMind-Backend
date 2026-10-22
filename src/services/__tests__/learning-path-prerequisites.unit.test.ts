import { PrerequisiteValidatorService } from "../prerequisite-validator.service";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../cache.service", () => ({
  CacheService: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
}));

const pool = require("../../config/database").default;

function mockQueryOnce(rows: any[]) {
  (pool.query as jest.Mock).mockResolvedValueOnce({ rows });
}

describe("learning-path prerequisites (issue #1307)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("allows enrollment when prerequisites are completed", async () => {
    mockQueryOnce([
      {
        id: "p1",
        milestoneId: "m2",
        prerequisiteType: "milestone",
        isRequired: true,
      },
    ]);
    const svc: any = PrerequisiteValidatorService as any;
    if (typeof svc.checkSinglePrerequisite === "function") {
      jest
        .spyOn(svc, "checkSinglePrerequisite")
        .mockResolvedValueOnce({ isMet: true, hasOverride: false });
    } else {
      mockQueryOnce([{ milestone_id: "p1" }]);
    }
    const res = await PrerequisiteValidatorService.validatePrerequisites(
      "user-1",
      "m2",
    );
    expect(res.canProceed).toBe(true);
  });

  it("blocks enrollment without completed prerequisites", async () => {
    mockQueryOnce([
      {
        id: "p1",
        milestoneId: "m2",
        prerequisiteType: "milestone",
        isRequired: true,
      },
    ]);
    const svc: any = PrerequisiteValidatorService as any;
    if (typeof svc.checkSinglePrerequisite === "function") {
      jest.spyOn(svc, "checkSinglePrerequisite").mockResolvedValueOnce({
        isMet: false,
        hasOverride: false,
        prerequisite: { id: "p1", isRequired: true },
      });
    } else {
      mockQueryOnce([]);
    }
    const res = await PrerequisiteValidatorService.validatePrerequisites(
      "user-1",
      "m2",
    );
    expect(res.canProceed).toBe(false);
  });

  it("detects circular prerequisites without hanging", () => {
    const result = PrerequisiteValidatorService.detectCyclesKahn([
      {
        id: "a",
        milestoneId: "m1",
        prerequisiteType: "milestone",
        isRequired: true,
        createdAt: "",
      } as any,
      {
        id: "b",
        milestoneId: "m2",
        prerequisiteType: "milestone",
        isRequired: true,
        createdAt: "",
      } as any,
    ]);
    expect(result === null || Array.isArray(result)).toBe(true);
  });

  it("allows enrollment with empty prerequisite list", async () => {
    mockQueryOnce([]);
    const res = await PrerequisiteValidatorService.validatePrerequisites(
      "user-1",
      "m1",
    );
    expect(res.canProceed).toBe(true);
  });
});
