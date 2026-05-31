import { env } from "../config/env";
import { logger } from "../utils/logger.utils";
import {
  processImage,
  createResponsiveImages,
  createLQIP,
  ImageFormat,
} from "../utils/image.utils";
import crypto = require("crypto");

export type CDNProvider = "cloudfront" | "cloudflare" | "fastly";

export interface CDNConfig {
  provider: CDNProvider;
  domains: string[];
  cacheRules: CacheRule[];
  optimization: {
    imageResize: boolean;
    webpConversion: boolean;
    compression: boolean;
  };
}

export interface CacheRule {
  pattern: string; // glob-style path pattern, e.g. "/images/*"
  ttl: number; // seconds
  staleWhileRevalidate?: number;
}

export interface InvalidationResult {
  provider: CDNProvider;
  paths: string[];
  invalidationId?: string;
  success: boolean;
}

export interface OptimizedImageOptions {
  width?: number;
  height?: number;
  format?: ImageFormat;
  quality?: number;
}

export interface ResponsiveImageOptions {
  widths?: number[];
  format?: ImageFormat;
  quality?: number;
}

export interface AssetVersionOptions {
  useHash: boolean;
  hashLength: number;
}

// Default cache rules per asset type
const DEFAULT_CACHE_RULES: CacheRule[] = [
  { pattern: "/images/*", ttl: 86400, staleWhileRevalidate: 3600 }, // 1 day
  { pattern: "/videos/*", ttl: 604800, staleWhileRevalidate: 86400 }, // 7 days
  { pattern: "/documents/*", ttl: 86400, staleWhileRevalidate: 3600 }, // 1 day
  { pattern: "/static/*", ttl: 2592000 }, // 30 days
];

function getConfig(): CDNConfig | null {
  if (!env.CDN_PROVIDER || !env.CDN_BASE_URL) return null;

  // Support both single domain (baseUrl) and multiple domains (domains)
  const domains = env.CDN_DOMAINS
    ? env.CDN_DOMAINS.split(",").map((d) => d.trim())
    : [env.CDN_BASE_URL];

  return {
    provider: env.CDN_PROVIDER,
    domains,
    cacheRules: DEFAULT_CACHE_RULES,
    optimization: {
      imageResize: env.CDN_IMAGE_RESIZE !== "false",
      webpConversion: env.CDN_WEBP_CONVERSION !== "false",
      compression: env.CDN_COMPRESSION !== "false",
    },
  };
}

/**
 * Rewrite an origin asset path to its CDN URL.
 * Falls back to the original path when CDN is not configured.
 * @param assetPath - The asset path to rewrite
 * @param options - Optional configuration (domain index, versioning)
 * @returns The CDN URL for the asset
 */
function getAssetUrl(
  assetPath: string,
  options: {
    domainIndex?: number;
    version?: string;
    useVersioning?: boolean;
  } = {},
): string {
  const config = getConfig();
  if (!config) return assetPath;

  // Select domain (default to first, or specified index)
  const domainIndex = options.domainIndex ?? 0;
  const domain = config.domains[domainIndex] ?? config.domains[0];
  if (!domain) return assetPath;

  const base = domain.replace(/\/$/, "");
  const path = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;

  let url = `${base}${path}`;

  // Add versioning if requested
  if (options.useVersioning && options.version) {
    const separator = url.includes("?") ? "&" : "?";
    url += `${separator}v=${options.version}`;
  }

  return url;
}

/**
 * Generate a version string for asset cache busting.
 * @param content - The asset content to generate version from
 * @param options - Versioning options
 * @returns A version string suitable for cache busting
 */
function generateAssetVersion(
  content: Buffer | string,
  options: AssetVersionOptions = { useHash: true, hashLength: 8 },
): string {
  if (options.useHash) {
    const hash = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex")
      .substring(0, options.hashLength);
    return hash;
  } else {
    // Fallback to timestamp-based versioning
    return Date.now().toString();
  }
}

/**
 * Return the Cache-Control header value for a given path based on cache rules.
 */
function getCacheControlHeader(assetPath: string): string {
  const config = getConfig();
  const rules = config?.cacheRules ?? DEFAULT_CACHE_RULES;

  for (const rule of rules) {
    if (matchesPattern(assetPath, rule.pattern)) {
      const swr = rule.staleWhileRevalidate
        ? `, stale-while-revalidate=${rule.staleWhileRevalidate}`
        : "";
      return `public, max-age=${rule.ttl}${swr}`;
    }
  }
  return "public, max-age=3600"; // default 1 hour
}

/** Simple glob-style pattern matching (supports only `*` wildcard). */
function matchesPattern(path: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
      "$",
  );
  return regex.test(path);
}

/**
 * Process and optimize an image for CDN delivery.
 * @param buffer - Original image buffer
 * @param options - Optimization options
 * @returns Optimized image buffer and metadata
 */
async function optimizeImage(
  buffer: Buffer,
  options: OptimizedImageOptions = {},
): Promise<{
  buffer: Buffer;
  format: ImageFormat;
  width: number;
  height: number;
  size: number;
}> {
  const config = getConfig();
  if (!config || !config.optimization.imageResize) {
    return {
      buffer,
      format: "jpeg" as ImageFormat, // default assumption
      width: 0,
      height: 0,
      size: buffer.length,
    };
  }

  // Set defaults
  const width = options.width;
  const height = options.height;
  const format =
    options.format ??
    ((config.optimization.webpConversion ? "webp" : "jpeg") as ImageFormat);
  const quality = options.quality ?? 80;

  return await processImage(buffer, { width, height }, format, quality);
}

/**
 * Create responsive image variants for lazy loading support.
 * @param buffer - Original image buffer
 * @param options - Responsive image options
 * @Array of image variants with different widths
 */
async function createResponsiveVariants(
  buffer: Buffer,
  options: ResponsiveImageOptions = {},
): Promise<
  Array<{
    width: number;
    buffer: Buffer;
    format: ImageFormat;
  }>
> {
  const config = getConfig();
  if (!config || !config.optimization.imageResize) {
    return [
      {
        width: 0,
        buffer,
        format: "jpeg" as ImageFormat,
      },
    ];
  }

  const widths = options.widths ?? [320, 640, 1024, 1920];
  const format =
    options.format ??
    ((config.optimization.webpConversion ? "webp" : "jpeg") as ImageFormat);
  const quality = options.quality ?? 80;

  return await createResponsiveImages(buffer, widths, format, quality);
}

/**
 * Generate a low-quality image placeholder (LQIP) for progressive loading.
 * @param buffer - Original image buffer
 * @param options - LQIP options
 * @returns Base64 encoded placeholder image
 */
async function createLowQualityPlaceholder(
  buffer: Buffer,
  options: { width?: number; quality?: number } = {},
): Promise<string> {
  const width = options.width ?? 20;
  const quality = options.quality ?? 10;

  return await createLQIP(buffer, width, quality);
}

// ---------------------------------------------------------------------------
// Provider-specific invalidation
// ---------------------------------------------------------------------------

async function invalidateCloudFront(
  paths: string[],
): Promise<InvalidationResult> {
  const distributionId = env.CDN_CLOUDFRONT_DISTRIBUTION_ID;
  if (!distributionId)
    throw new Error("CDN_CLOUDFRONT_DISTRIBUTION_ID is not set");

  // Lazy-load AWS SDK to avoid hard dependency when not using CloudFront.
  // Install @aws-sdk/client-cloudfront to enable this provider.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { CloudFrontClient, CreateInvalidationCommand } = (await import(
    "@aws-sdk/client-cloudfront" as string
  )) as any;
  const client = new CloudFrontClient({ region: env.AWS_REGION });
  const result = await client.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `invalidation-${Date.now()}`,
        Paths: { Quantity: paths.length, Items: paths },
      },
    }),
  );
  return {
    provider: "cloudfront",
    paths,
    invalidationId: result.Invalidation?.Id,
    success: true,
  };
}

async function invalidateCloudflare(
  paths: string[],
): Promise<InvalidationResult> {
  const zoneId = env.CDN_CLOUDFLARE_ZONE_ID;
  const token = env.CDN_CLOUDFLARE_API_TOKEN;
  const baseUrl = env.CDN_BASE_URL;
  if (!zoneId || !token || !baseUrl) {
    throw new Error(
      "CDN_CLOUDFLARE_ZONE_ID, CDN_CLOUDFLARE_API_TOKEN, and CDN_BASE_URL are required",
    );
  }

  const files = paths.map((p) => `${baseUrl.replace(/\/$/, "")}${p}`);
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare purge failed: ${res.status} ${body}`);
  }
  return { provider: "cloudflare", paths, success: true };
}

async function invalidateFastly(paths: string[]): Promise<InvalidationResult> {
  const serviceId = env.CDN_FASTLY_SERVICE_ID;
  const apiKey = env.CDN_FASTLY_API_KEY;
  if (!serviceId || !apiKey) {
    throw new Error(
      "CDN_FASTLY_SERVICE_ID and CDN_FASTLY_API_KEY are required",
    );
  }

  // Fastly supports surrogate-key purge; fall back to path-by-path purge
  await Promise.all(
    paths.map((path) =>
      fetch(`https://api.fastly.com/service/${serviceId}/purge${path}`, {
        method: "POST",
        headers: { "Fastly-Key": apiKey },
      }).then((res) => {
        if (!res.ok)
          throw new Error(`Fastly purge failed for ${path}: ${res.status}`);
      }),
    ),
  );
  return { provider: "fastly", paths, success: true };
}

/**
 * Invalidate CDN cache for the given paths.
 * Paths should be absolute, e.g. ["/images/avatar.jpg"].
 */
async function invalidate(paths: string[]): Promise<InvalidationResult> {
  const config = getConfig();
  if (!config) throw new Error("CDN is not configured");

  logger.info("CDN cache invalidation requested", {
    provider: config.provider,
    paths,
  });

  try {
    let result: InvalidationResult;
    switch (config.provider) {
      case "cloudfront":
        result = await invalidateCloudFront(paths);
        break;
      case "cloudflare":
        result = await invalidateCloudflare(paths);
        break;
      case "fastly":
        result = await invalidateFastly(paths);
        break;
    }
    logger.info("CDN cache invalidation succeeded", {
      provider: config.provider,
      paths,
    });
    return result;
  } catch (err) {
    logger.error("CDN cache invalidation failed", {
      provider: config.provider,
      paths,
      err,
    });
    throw err;
  }
}

export const CDNService = {
  getConfig,
  getAssetUrl,
  getCacheControlHeader,
  invalidate,
  optimizeImage,
  createResponsiveVariants,
  createLowQualityPlaceholder,
  generateAssetVersion,
};
