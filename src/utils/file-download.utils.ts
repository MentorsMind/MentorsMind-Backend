import path from "path";
import { Response } from "express";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;
const RESERVED_FILENAME_CHARS = /[\\/:*?"<>|]+/g;
const MULTIPLE_DASHES = /-+/g;
const WHITESPACE = /\s+/g;
const LEADING_OR_TRAILING_DOTS = /^\.+|\.+$/g;
const LEADING_OR_TRAILING_SPACES = /^ +| +$/g;

export function sanitizeFileName(input: string, fallback = "download"): string {
  const normalized = input.normalize("NFKC");
  const sanitized = normalized
    .replace(CONTROL_CHARS, "")
    .replace(RESERVED_FILENAME_CHARS, "-")
    .replace(WHITESPACE, "-")
    .replace(MULTIPLE_DASHES, "-")
    .replace(LEADING_OR_TRAILING_DOTS, "")
    .replace(LEADING_OR_TRAILING_SPACES, "")
    .trim();

  return sanitized.length > 0 ? sanitized : fallback;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}

function toAsciiFallback(value: string, fallback: string): string {
  const ascii = value
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/["\\]/g, "_")
    .replace(WHITESPACE, "-")
    .replace(MULTIPLE_DASHES, "-")
    .trim();

  return ascii.length > 0 ? ascii : fallback;
}

export function buildAttachmentContentDisposition(filename: string): string {
  const safeFileName = sanitizeFileName(filename);
  const asciiFallback = toAsciiFallback(safeFileName, "download");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987(safeFileName)}`;
}

export function setFileDownloadHeaders(res: Response, filename: string, contentType: string): void {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", buildAttachmentContentDisposition(filename));
  // Stop browsers from MIME-sniffing the download into an executable type (e.g. HTML).
  res.setHeader("X-Content-Type-Options", "nosniff");
}

export function sanitizeArchiveEntryName(filename: string, fallback = "download.bin"): string {
  const baseName = path.posix.basename(filename.replace(/\\/g, "/"));
  return sanitizeFileName(baseName, fallback);
}
