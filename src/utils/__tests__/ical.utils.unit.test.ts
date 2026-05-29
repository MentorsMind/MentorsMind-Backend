import { generateICalToken, buildICalFeed, ICalSession } from "../ical.utils";

// ── generateICalToken ─────────────────────────────────────────────────────────

describe("generateICalToken", () => {
  it("returns a string of exactly 64 characters", () => {
    expect(generateICalToken()).toHaveLength(64);
  });

  it("returns only lowercase hex characters", () => {
    expect(generateICalToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different token on every call (no collisions in 100 samples)", () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateICalToken()),
    );
    expect(tokens.size).toBe(100);
  });

  it("throws if crypto.randomBytes somehow returns wrong length (invariant check)", () => {
    // Patch randomBytes to return too few bytes to simulate a hypothetical failure
    const crypto = require("crypto");
    const original = crypto.randomBytes;
    crypto.randomBytes = (_n: number) => Buffer.alloc(16); // 16 bytes → 32 hex chars
    try {
      expect(() => generateICalToken()).toThrow(
        "generateICalToken: expected 64 hex chars, got 32",
      );
    } finally {
      crypto.randomBytes = original;
    }
  });
});

// ── buildICalFeed ─────────────────────────────────────────────────────────────

const session: ICalSession = {
  uid: "booking-uuid-1",
  title: "Mentoring Session: Jane Smith & John Doe",
  mentorName: "Jane Smith",
  learnerName: "John Doe",
  startTime: new Date("2026-05-01T10:00:00Z"),
  endTime: new Date("2026-05-01T11:00:00Z"),
  meetingLink: "https://meet.example.com/abc123",
  location: "Online",
};

describe("buildICalFeed", () => {
  it("begins with BEGIN:VCALENDAR and ends with END:VCALENDAR", () => {
    const feed = buildICalFeed([session]);
    expect(feed.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(feed.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("includes VERSION:2.0 and CALSCALE:GREGORIAN", () => {
    const feed = buildICalFeed([session]);
    expect(feed).toContain("VERSION:2.0");
    expect(feed).toContain("CALSCALE:GREGORIAN");
  });

  it("includes a VEVENT block for each session", () => {
    const feed = buildICalFeed([session]);
    expect(feed).toContain("BEGIN:VEVENT");
    expect(feed).toContain("END:VEVENT");
  });

  it("encodes the session UID into the VEVENT", () => {
    const feed = buildICalFeed([session]);
    expect(feed).toContain("UID:booking-uuid-1@mentorminds");
  });

  it("encodes DTSTART and DTEND in UTC format", () => {
    const feed = buildICalFeed([session]);
    expect(feed).toContain("DTSTART:20260501T100000Z");
    expect(feed).toContain("DTEND:20260501T110000Z");
  });

  it("uses the custom calendar name when provided", () => {
    const feed = buildICalFeed([session], "MentorMinds – Jane Smith");
    expect(feed).toContain("X-WR-CALNAME:MentorMinds – Jane Smith");
  });

  it("produces an empty VCALENDAR (no VEVENTs) for an empty session list", () => {
    const feed = buildICalFeed([]);
    expect(feed).not.toContain("BEGIN:VEVENT");
    expect(feed).toContain("BEGIN:VCALENDAR");
  });

  it("includes the meeting link in DESCRIPTION and URL", () => {
    const feed = buildICalFeed([session]);
    expect(feed).toContain("meet.example.com/abc123");
  });

  it("escapes special iCal characters in the title", () => {
    const specialSession: ICalSession = {
      ...session,
      title: "Session: mentor, learner; co-op",
    };
    const feed = buildICalFeed([specialSession]);
    // Commas and semicolons must be backslash-escaped in SUMMARY
    expect(feed).toContain("\\,");
    expect(feed).toContain("\\;");
  });

  it("produces multiple VEVENT blocks for multiple sessions", () => {
    const session2: ICalSession = { ...session, uid: "booking-uuid-2" };
    const feed = buildICalFeed([session, session2]);
    const count = (feed.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(count).toBe(2);
  });
});
