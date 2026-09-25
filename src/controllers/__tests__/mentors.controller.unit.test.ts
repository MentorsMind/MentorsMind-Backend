import { createHash } from "crypto";
import { MentorsController } from "../mentors.controller";
import { MentorsService } from "../../services/mentors.service";

jest.mock("../../services/mentors.service");

describe("MentorsController.getProfile", () => {
  const mentor = {
    id: "mentor-1",
    updated_at: new Date("2026-01-15T10:00:00.000Z"),
    first_name: "Ada",
  };

  function responseMock() {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
      }),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (MentorsService.findById as jest.Mock).mockResolvedValue(mentor);
  });

  it("returns 304 for a matching ETag", async () => {
    const req = { params: { id: mentor.id }, headers: {} } as any;
    const firstResponse = responseMock();

    await MentorsController.getProfile(req, firstResponse as any);
    const etag = `"${createHash("sha1").update(JSON.stringify(mentor)).digest("hex")}"`;

    req.headers["if-none-match"] = etag;
    const cachedResponse = responseMock();
    await MentorsController.getProfile(req, cachedResponse as any);

    expect(cachedResponse.headers.ETag).toBe(etag);
    expect(cachedResponse.status).toHaveBeenCalledWith(304);
    expect(cachedResponse.end).toHaveBeenCalled();
    expect(cachedResponse.json).not.toHaveBeenCalled();
    expect(firstResponse.headers["Last-Modified"]).toBe("Thu, 15 Jan 2026 10:00:00 GMT");
  });
});
