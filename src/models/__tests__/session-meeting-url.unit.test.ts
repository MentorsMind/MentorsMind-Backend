import { SessionModel } from "../session.model";
import pool from "../../config/database";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
  db: { query: jest.fn(), connect: jest.fn() },
}));

const queryMock = (pool.query as jest.Mock);

const validPayload = (meetingUrl: string) => ({
  meetingUrl,
  meetingProvider: "zoom",
  meetingRoomId: "room-1",
  meetingExpiresAt: new Date("2026-11-01T10:00:00Z"),
});

describe("SessionModel.updateMeetingUrl meeting_url validation (#1305)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("accepts a valid HTTPS URL", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "s1", meeting_url: "https://zoom.us/j/123" }] });
    const result = await SessionModel.updateMeetingUrl("s1", validPayload("https://zoom.us/j/123"));
    expect(result?.meeting_url).toBe("https://zoom.us/j/123");
  });

  it("rejects HTTP URLs", async () => {
    await expect(
      SessionModel.updateMeetingUrl("s1", validPayload("http://example.com/meeting")),
    ).rejects.toThrow("meetingUrl must be a valid https:// URL");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects javascript: URLs", async () => {
    await expect(
      SessionModel.updateMeetingUrl("s1", validPayload("javascript:alert(1)")),
    ).rejects.toThrow("meetingUrl must be a valid https:// URL");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects data: URLs", async () => {
    await expect(
      SessionModel.updateMeetingUrl("s1", validPayload("data:text/html,<script>alert(1)</script>")),
    ).rejects.toThrow("meetingUrl must be a valid https:// URL");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects empty strings", async () => {
    await expect(SessionModel.updateMeetingUrl("s1", validPayload(""))).rejects.toThrow(
      "meetingUrl must be a non-empty https:// URL",
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects non-URL strings", async () => {
    await expect(SessionModel.updateMeetingUrl("s1", validPayload("not-a-url"))).rejects.toThrow(
      "meetingUrl must be a valid https:// URL",
    );
    expect(queryMock).not.toHaveBeenCalled();
  });
});
