import { NextFunction, Request, Response } from "express";
import zlib from "zlib";

export interface MobileContext {
  isMobile: boolean;
  platform?: string;
  appVersion?: string;
}

export const mobileApiMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const userAgent = (req.headers["user-agent"] ?? "") as string;
  const isMobile =
    /android|iphone|ipad|ipod|mobile/i.test(userAgent) ||
    !!req.headers["x-mobile-client"] ||
    req.path.startsWith("/mobile") ||
    req.originalUrl.includes("/mobile/");

  const platform =
    (req.headers["x-mobile-platform"] as string | undefined) ??
    (userAgent.includes("iPhone")
      ? "ios"
      : userAgent.includes("Android")
        ? "android"
        : undefined);

  const appVersion =
    (req.headers["x-app-version"] as string | undefined) ?? undefined;

  (req as Request & { mobile?: MobileContext }).mobile = {
    isMobile,
    platform,
    appVersion,
  };

  res.setHeader("X-Mobile-API", "true");
  res.setHeader("X-Mobile-Client", String(isMobile));

  if (isMobile) {
    res.setHeader("Cache-Control", "private, no-transform");
    res.setHeader("X-Compression-Enabled", "true");
  }

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    const acceptEncoding = (
      (req.headers["accept-encoding"] as string) ?? ""
    ).toLowerCase();
    const shouldCompress =
      isMobile &&
      req.headers["x-mobile-compression"] !== "false" &&
      acceptEncoding.includes("gzip");

    if (!shouldCompress) {
      return originalJson(body);
    }

    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const compressed = zlib.gzipSync(Buffer.from(payload, "utf8"));

    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Compressed-Response", "true");

    return res.send(compressed);
  }) as typeof res.json;

  next();
};

export default mobileApiMiddleware;
