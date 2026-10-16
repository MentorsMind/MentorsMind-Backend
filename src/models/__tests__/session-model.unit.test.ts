import { SessionModel } from "../session.model";
import { db } from "../../config/database";
import { getDefaultCollaborationState } from "../../types/collaboration.types";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
  db: { query: jest.fn(), connect: jest.fn() },
}));

const queryMock = db.query as jest.Mock;

describe("SessionModel.create collaboration_state (#1300)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("initializes collaboration_state to the default object, not null", async () => {
    const expected = getDefaultCollaborationState();
    queryMock.mockResolvedValueOnce({ rows: [{ id: "session-1", collaboration_state: expected }] });

    const result = await SessionModel.create({
      mentorId: "mentor-1",
      menteeId: "mentee-1",
      title: "Intro call",
      scheduledAt: new Date("2026-10-20T10:00:00Z"),
      durationMinutes: 60,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0] as [string, unknown[]];
    const stored = params[7];
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    expect(parsed).toEqual(expected);
    expect(parsed).not.toBeNull();
    expect(parsed.participants).toEqual([]);
    expect(result.collaboration_state).toEqual(expected);
  });

  it("default state matches the CollaborationState type shape", () => {
    const state = getDefaultCollaborationState();
    expect(state.whiteboardData).toBeDefined();
    expect(state.sharedCode.content).toBe("");
    expect(state.screenShare.active).toBe(false);
  });
});
