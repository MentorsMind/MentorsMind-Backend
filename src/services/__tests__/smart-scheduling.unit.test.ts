import pool from "../../config/database";
import { SmartSchedulingService } from "../smart-scheduling.service";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

const mockedQuery = pool.query as jest.Mock;
const mentorId = "mentor-1";
const menteeId = "mentee-1";
const start = new Date("2026-01-15T10:00:00.000Z");
const end = new Date("2026-01-15T12:00:00.000Z");

function mockSchedulingQueries(availabilitySchedule: Record<string, unknown> | null, mentorTimezone = "UTC", menteeTimezone = "UTC") {
  mockedQuery.mockImplementation(async (query: string) => {
    if (query.includes("FROM users")) {
      return {
        rows: [
          { id: mentorId, timezone: mentorTimezone, availability_schedule: availabilitySchedule },
          { id: menteeId, timezone: menteeTimezone, availability_schedule: null },
        ],
      };
    }
    return { rows: [] };
  });
}

describe("SmartSchedulingService.suggestOptimalTimes", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-15T10:00:00Z"));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("suggests slots from one available window", async () => {
    mockSchedulingQueries({
      thursday: { enabled: true, slots: [{ start: "10:00", end: "12:00" }] },
    });

    const suggestions = await SmartSchedulingService.suggestOptimalTimes(
      mentorId,
      menteeId,
      60,
      start,
      end,
    );

    expect(suggestions.length).toBe(3);
    expect(suggestions[0].suggestedTimes[0].start).toEqual(start);
    expect(suggestions[0].suggestedTimes[0].end).toEqual(new Date("2026-01-15T11:00:00.000Z"));
  });

  it("returns an empty array when no slots are available", async () => {
    mockSchedulingQueries({
      thursday: { enabled: true, slots: [{ start: "13:00", end: "14:00" }] },
    });

    const suggestions = await SmartSchedulingService.suggestOptimalTimes(
      mentorId,
      menteeId,
      60,
      start,
      end,
    );

    expect(suggestions).toEqual([]);
  });

  it("excludes slots outside standard business hours", async () => {
    mockSchedulingQueries(null);

    const suggestions = await SmartSchedulingService.suggestOptimalTimes(
      mentorId,
      menteeId,
      60,
      new Date("2026-01-15T08:00:00.000Z"),
      new Date("2026-01-15T09:00:00.000Z"),
    );

    expect(suggestions).toEqual([]);
  });

  it("applies mentor and mentee timezone offsets when scoring slots", async () => {
    mockSchedulingQueries(
      { thursday: { enabled: true, slots: [{ start: "10:00", end: "12:00" }] } },
      "America/New_York",
      "Asia/Tokyo",
    );

    const suggestions = await SmartSchedulingService.suggestOptimalTimes(
      mentorId,
      menteeId,
      60,
      new Date("2026-01-15T15:00:00.000Z"),
      new Date("2026-01-15T16:00:00.000Z"),
    );

    expect(suggestions.length).toBe(1);
    expect(suggestions[0].suggestedTimes[0].start).toEqual(new Date("2026-01-15T15:00:00.000Z"));
    expect(suggestions[0].factors.timezoneOptimal).toBe(false);
  });
});
