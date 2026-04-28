/**
 * Sanitization Utilities
 * Provides XSS prevention, SQL injection detection, and general input sanitization.
 */

import { logger } from "./logger.utils";
import { validationConfig } from "../config/validation.config";

// ---------------------------------------------------------------------------
// HTML / XSS sanitization
// ---------------------------------------------------------------------------

/** HTML entities that must be escaped to neutralize XSS payloads */
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#x60;",
  "=": "&#x3D;",
};

/**
 * Escape HTML special characters to prevent XSS when the value will be
 * rendered in an HTML context. For API JSON responses this is a defence-in-
 * depth measure; the primary guard is Content-Type: application/json.
 */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"'`=/]/g, (char) => HTML_ENTITIES[char] ?? char);
}

/**
 * Strip dangerous patterns from a string (script tags, inline event handlers,
 * javascript: URIs, data:text/html URIs).
 */
export function stripXss(input: string): string {
  let sanitized = input;
  for (const pattern of validationConfig.security.dangerousPatterns) {
    // Reset lastIndex for global regexes
    if (pattern instanceof RegExp && pattern.global) {
      pattern.lastIndex = 0;
    }
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized;
}

/**
 * Full XSS sanitization: strip dangerous patterns then trim whitespace.
 * Use this on any freeform text field before persisting.
 */
export function sanitizeString(input: string): string {
  return stripXss(input).trim();
}

// ---------------------------------------------------------------------------
// SQL injection detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the string contains patterns commonly associated with SQL
 * injection. This is NOT meant to replace parameterized queries – it is an
 * additional layer that can log or block obviously malicious input.
 */
export function containsSqlInjection(input: string): boolean {
  for (const pattern of validationConfig.security.sqlInjectionPatterns) {
    if (pattern instanceof RegExp && pattern.global) {
      pattern.lastIndex = 0;
    }
    if (pattern.test(input)) {
      return true;
    }
  }
  return false;
}

/**
 * Check a string for SQL injection patterns.
 * Logs a warning and returns the matched indicator if found.
 */
export function detectAndLogSqlInjection(
  input: string,
  fieldName: string,
  requestId?: string,
): boolean {
  if (containsSqlInjection(input)) {
    logger.warn("Potential SQL injection attempt detected", {
      field: fieldName,
      requestId,
      sample: input.slice(0, validationConfig.logging.maxLogFieldLength),
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deep object sanitization
// ---------------------------------------------------------------------------

export interface SanitizeOptions {
  /** Strip XSS patterns (default: true) */
  stripXssPatterns?: boolean;
  /** Trim whitespace from strings (default: true) */
  trimStrings?: boolean;
  /** Remove keys whose values are undefined (default: true) */
  removeUndefined?: boolean;
  /** Maximum object depth to recurse (default: 10) */
  maxDepth?: number;
}

const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  stripXssPatterns: true,
  trimStrings: true,
  removeUndefined: true,
  maxDepth: 10,
};

/**
 * Recursively sanitize a plain object / array / primitive value.
 * - Strings: trimmed and XSS-stripped.
 * - Objects / arrays: recursed up to `maxDepth`.
 * - Numbers, booleans, null: returned as-is.
 */
export function sanitizeObject(
  value: unknown,
  options: SanitizeOptions = {},
  _depth = 0,
): unknown {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (_depth > opts.maxDepth) {
    return value;
  }

  if (typeof value === "string") {
    let result = value;
    if (opts.stripXssPatterns) result = stripXss(result);
    if (opts.trimStrings) result = result.trim();
    return result;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item, opts, _depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (opts.removeUndefined && val === undefined) continue;
      sanitized[key] = sanitizeObject(val, opts, _depth + 1);
    }
    return sanitized;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Stellar address sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a candidate Stellar public key string: strip whitespace and
 * normalize to uppercase. Validation (length, prefix, checksum) is done
 * separately via Zod schemas.
 */
export function sanitizeStellarAddress(input: string): string {
  return input.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Generic field sanitizers
// ---------------------------------------------------------------------------

/** Sanitize an email: lowercase + trim. */
export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Sanitize a URL: trim and ensure it doesn't start with javascript: */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^javascript:/i.test(trimmed)) return "";
  return trimmed;
}

/** Normalize a phone number: remove all non-digit and non-plus characters. */
export function sanitizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

/**
 * Truncate a string to a maximum length, appending '…' if truncated.
 * Useful before persisting to avoid silently overflowing column limits.
 */
export function truncateString(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength - 1) + "…";
}

// ---------------------------------------------------------------------------
// IP address anonymization (GDPR)
// ---------------------------------------------------------------------------

/**
 * Anonymize an IP address before storage:
 * - IPv4: zero the last octet  (192.168.1.100 → 192.168.1.0)
 * - IPv6: zero the last 80 bits / 5 groups (keep first 3 groups)
 */
export function anonymizeIp(ip: string): string {
  if (!ip || ip === "unknown") return ip;
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.replace(/\.\d+$/, ".0");
  }
  // IPv6: keep first 3 groups, zero the rest
  const parts = ip.split(":");
  if (parts.length >= 3) {
    return parts
      .slice(0, 3)
      .concat(new Array(parts.length - 3).fill("0"))
      .join(":");
  }
  return ip;
}
