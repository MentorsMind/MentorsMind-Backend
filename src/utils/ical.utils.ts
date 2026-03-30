import crypto from "crypto";

export interface ICalSession {
  uid: string;
  title: string;
  mentorName: string;
  learnerName: string;
  startTime: Date;
  endTime: Date;
  meetingLink?: string;
  location?: string;
  description?: string;
}

/**
 * Escape special characters in iCal text fields
 */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

/**
 * Format a Date to iCal UTC datetime string (YYYYMMDDTHHmmssZ)
 */
function formatICalDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * Fold long iCal lines at 75 octets per RFC 5545
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  chunks.push(line.slice(0, 75));
  let i = 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

/**
 * Generate an iCal VEVENT block for a single session
 */
function generateVEvent(session: ICalSession, _prodId: string): string {
  const now = formatICalDate(new Date());
  const dtStart = formatICalDate(session.startTime);
  const dtEnd = formatICalDate(session.endTime);

  const descriptionParts: string[] = [];
  if (session.meetingLink)
    descriptionParts.push(`Meeting Link: ${session.meetingLink}`);
  if (session.description) descriptionParts.push(session.description);
  const description =
    descriptionParts.join("\\n") || `Session with ${session.mentorName}`;

  const location = session.location || session.meetingLink || "";

  const lines = [
    "BEGIN:VEVENT",
    foldLine(`UID:${session.uid}@mentorminds`),
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    foldLine(`SUMMARY:${escapeICalText(session.title)}`),
    foldLine(`DESCRIPTION:${escapeICalText(description)}`),
    ...(location ? [foldLine(`LOCATION:${escapeICalText(location)}`)] : []),
    ...(session.meetingLink ? [foldLine(`URL:${session.meetingLink}`)] : []),
    foldLine(
      `ORGANIZER;CN=${escapeICalText(session.mentorName)}:MAILTO:noreply@mentorminds.com`,
    ),
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
  ];

  return lines.join("\r\n");
}

/**
 * Build a complete iCal (.ics) feed from a list of sessions
 */
export function buildICalFeed(
  sessions: ICalSession[],
  calendarName = "MentorMinds Sessions",
): string {
  const prodId = "-//MentorMinds//MentorMinds Calendar//EN";
  const vEvents = sessions.map((s) => generateVEvent(s, prodId)).join("\r\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${escapeICalText(calendarName)}`),
    "X-WR-TIMEZONE:UTC",
    "X-WR-CALDESC:Your MentorMinds mentoring sessions",
    vEvents,
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}

/**
 * Generate a cryptographically secure iCal token
 */
export function generateICalToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
