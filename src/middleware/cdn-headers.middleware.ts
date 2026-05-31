import { Request, Response, NextFunction } from "express";
import { CDNService } from "../services/cdn.service";

/**
 * Middleware that sets Cache-Control and CDN-specific headers on responses
 * for static asset routes (images, videos, documents).
 *
 * Mount this middleware on asset-serving routes, e.g.:
 *   router.use("/images", cdnHeaders, serveStatic(...))
 */
export function cdnHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalSend = res.send.bind(res);

  res.send = function (body?: unknown) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const cacheControl = CDNService.getCacheControlHeader(req.path);
      res.setHeader("Cache-Control", cacheControl);

      // Vary on Accept to support WebP negotiation
      res.setHeader("Vary", "Accept, Accept-Encoding");

      // Hint CDN to cache the response
      const config = CDNService.getConfig();
      if (config) {
        res.setHeader("X-CDN-Provider", config.provider);
      }
    }
    return originalSend(body);
  };

  next();
}
