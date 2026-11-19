import { BookingModel } from "../booking.model";
import { db } from "../../config/database";

jest.mock("../../config/database", () => ({
  db: { query: jest.fn(), connect: jest.fn() },
}));

const queryMock = db.query as jest.Mock;

describe("BookingModel.checkConflict SQL parameterization (#1193)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryMock.mockResolvedValue({ rows: [{ count: "0" }] });
  });

  it("uses parameterized make_interval with no string interpolation", async () => {
    await BookingModel.checkConflict(
      "mentor-1",
      new Date("2026-05-01T10:00:00Z"),
      60,
    );

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [text, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("make_interval(mins => duration_minutes)");
    expect(text).not.toContain("INTERVAL '");
    expect(text).not.toContain("${");
    // All dynamic values are bound parameters.
    expect(text).toContain("$1");
    expect(text).toContain("$2");
    expect(text).toContain("$3");
    expect(params[0]).toBe("mentor-1");
  });

  it("cannot be manipulated by a string like '60; DROP TABLE bookings'", async () => {
    const malicious = "60; DROP TABLE bookings" as unknown as number;

    await expect(
      BookingModel.checkConflict(
        "mentor-1",
        new Date("2026-05-01T10:00:00Z"),
        malicious,
      ),
    ).rejects.toThrow();

    // If validation throws, no query runs. If it ever runs, the payload
    // must never appear in the SQL text.
    for (const [text] of queryMock.mock.calls as Array<[string]>) {
      expect(text).not.toContain("DROP TABLE");
      expect(text).not.toContain("60;");
    }
  });
});
