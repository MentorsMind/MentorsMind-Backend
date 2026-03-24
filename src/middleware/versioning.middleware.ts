import { Request, Response, NextFunction } from 'express';
import { API_VERSIONS, CURRENT_VERSION, SUPPORTED_VERSIONS } from '../config/api-versions.config';

/**
 * Versioning Middleware
 *
 * Responsibilities:
 * 1. Attach `X-API-Version` header to every response.
 * 2. Support `Accept-Version` request header as an alternative to URL versioning.
 * 3. Attach `Deprecation` and `Sunset` headers when the resolved version is deprecated.
 */
export function versioningMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Resolve version: URL segment takes priority, then Accept-Version header, then default
  const urlVersion = extractVersionFromUrl(req.path);
  const headerVersion = normalizeVersion(req.headers['accept-version'] as string | undefined);
  const resolvedVersion = urlVersion ?? headerVersion ?? CURRENT_VERSION;

  const versionConfig = API_VERSIONS[resolvedVersion];

  // Always set the resolved API version on the response
  res.setHeader('X-API-Version', resolvedVersion);

  // Warn if the requested version is unknown / inactive
  if (!versionConfig || !versionConfig.active) {
    // Fall through — the router will 404 naturally; we just set the header
    next();
    return;
  }

  // Attach deprecation headers when applicable
  if (versionConfig.deprecatedAt) {
    res.setHeader('Deprecation', versionConfig.deprecatedAt);
    if (versionConfig.sunsetAt) {
      res.setHeader('Sunset', versionConfig.sunsetAt);
    }
    if (versionConfig.deprecationMessage) {
      res.setHeader('X-Deprecation-Message', versionConfig.deprecationMessage);
    }
  }

  // Expose supported versions so clients can discover them
  res.setHeader('X-Supported-Versions', SUPPORTED_VERSIONS.join(', '));

  next();
}

/** Extract "v1", "v2", etc. from a URL path like /api/v1/users */
function extractVersionFromUrl(urlPath: string): string | undefined {
  const match = urlPath.match(/^\/api\/(v\d+)/);
  return match ? match[1] : undefined;
}

/** Normalise an Accept-Version value: strips leading "v" if missing, lowercases */
function normalizeVersion(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}
