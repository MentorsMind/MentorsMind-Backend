/** Express 5 types allow string | string[] for route params — normalize for service calls. */
export function routeParam(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value[0] ?? '' : value;
}

/**
 * Sanitize a non-UUID route parameter against path traversal.
 *
 * Rejects values that contain:
 *   - `..` (directory traversal)
 *   - `/` or `\` (path separators, raw or percent-encoded as %2F / %5C / %2f / %5c)
 *   - Null bytes (%00)
 *
 * Returns the value unchanged when safe, or throws a 400-level error when it
 * detects traversal characters so callers can let asyncHandler forward it.
 *
 * Usage:
 * ```ts
 * const name = sanitizeRouteParam(routeParam(req.params.name));
 * ```
 */
export function sanitizeRouteParam(value: string): string {
  // Block null bytes first (they can mask subsequent characters in some parsers).
  if (/\x00|%00/i.test(value)) {
    throw Object.assign(new Error('Invalid route parameter: null byte'), { status: 400 });
  }

  // Percent-decode before checking so encoded traversal sequences are caught.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw Object.assign(new Error('Invalid route parameter: malformed percent-encoding'), { status: 400 });
  }

  // Block traversal and path-separator characters in both raw and decoded forms.
  if (/\.\./.test(decoded) || /[/\\]/.test(decoded)) {
    throw Object.assign(
      new Error('Invalid route parameter: path traversal detected'),
      { status: 400 },
    );
  }

  return decoded;
}
