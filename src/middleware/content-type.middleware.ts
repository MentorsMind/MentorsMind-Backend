import { Request, Response, NextFunction } from "express";

const METHODS_REQUIRING_JSON = new Set(["POST", "PUT", "PATCH"]);

/**
 * Returns 415 Unsupported Media Type for POST/PUT/PATCH requests that don't
 * declare Content-Type: application/json. Express only populates req.body
 * when this header is present, so a missing header silently yields `{}` and
 * downstream validation reports confusing "field is required" errors instead
 * of the real problem. Must run before the body parsers so it can inspect
 * the raw header rather than the parsed body.
 */
export const requireJsonContentType = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!METHODS_REQUIRING_JSON.has(req.method)) {
    next();
    return;
  }

  const contentType = req.headers["content-type"];

  // Multipart file uploads and CSP violation reports are legitimate
  // non-JSON POST/PUT/PATCH bodies and are excluded from this check.
  if (
    contentType &&
    (contentType.includes("multipart/form-data") ||
      contentType.includes("application/csp-report"))
  ) {
    next();
    return;
  }

  if (!contentType || !contentType.includes("application/json")) {
    res.status(415).json({
      success: false,
      error: "Unsupported Media Type: Content-Type must be application/json",
    });
    return;
  }

  next();
};

export default requireJsonContentType;
