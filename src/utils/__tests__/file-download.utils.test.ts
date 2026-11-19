import { describe, expect, it } from "../../validators/__tests__/test-harness";
import {
  buildAttachmentContentDisposition,
  sanitizeArchiveEntryName,
  sanitizeFileName,
} from "../file-download.utils";

describe("sanitizeFileName", () => {
  it("removes control characters and path separators", () => {
    expect(sanitizeFileName('..\r\nquarterly/report".csv')).toBe("quarterly-report-.csv");
  });

  it("falls back when the filename becomes empty", () => {
    expect(sanitizeFileName("...\r\n///***", "fallback.csv")).toBe("fallback.csv");
  });
});

describe("sanitizeArchiveEntryName", () => {
  it("strips directory traversal segments from archive entry names", () => {
    expect(sanitizeArchiveEntryName("..\\..\\exports\\report.csv")).toBe("report.csv");
  });
});

describe("buildAttachmentContentDisposition", () => {
  it("returns a quoted ascii filename plus RFC 5987 encoded filename*", () => {
    expect(
      buildAttachmentContentDisposition("earnings report 2026.csv"),
    ).toBe(
      `attachment; filename="earnings-report-2026.csv"; filename*=UTF-8''earnings-report-2026.csv`,
    );
  });
});
