/**
 * CDN and edge configuration (issue #863).
 *
 * `cdn-geo.config.ts` holds the provider-specific cache strategies. This file
 * holds the decisions that apply across providers: which provider is primary,
 * which are failovers, what the edge is allowed to run, and how images are
 * negotiated.
 *
 * Everything reads from the environment with a working default, so a developer
 * without CDN credentials gets pass-through behaviour rather than a crash.
 */

export type CDNProviderName = "cloudfront" | "cloudflare" | "fastly";

export interface ImageNegotiationConfig {
  /** Formats to serve, best first. The first one the client accepts wins. */
  preferredFormats: ImageDeliveryFormat[];
  /** Widths generated for a responsive srcset. */
  breakpoints: number[];
  /** Quality for lossy formats, 1–100. */
  quality: number;
  /** Emit a blurred placeholder alongside each variant. */
  generatePlaceholder: boolean;
  /** Refuse to process anything larger, in bytes. */
  maxSourceBytes: number;
}

export type ImageDeliveryFormat = "avif" | "webp" | "jpeg" | "png";

export interface EdgeConfig {
  /** Run edge functions at all. */
  enabled: boolean;
  /** Milliseconds an edge function may run before it is abandoned. */
  timeoutMs: number;
  /** Regions the functions are deployed to, for reporting. */
  regions: string[];
}

export interface CDNConfiguration {
  primary: CDNProviderName;
  /** Tried in order when the primary is unhealthy. */
  failovers: CDNProviderName[];
  /** Public base URLs, one per provider. */
  domains: Partial<Record<CDNProviderName, string>>;
  images: ImageNegotiationConfig;
  edge: EdgeConfig;
}

/** MIME type for each delivery format, used in Accept negotiation. */
export const IMAGE_MIME_TYPES: Record<ImageDeliveryFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
};

export const DEFAULT_BREAKPOINTS = [320, 640, 960, 1280, 1920];

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Parsed, positive, ascending breakpoints, or the defaults when none parse. */
function envBreakpoints(): number[] {
  const parsed = envList("CDN_IMAGE_BREAKPOINTS", [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  return parsed.length > 0 ? parsed : DEFAULT_BREAKPOINTS;
}

function envProvider(name: string, fallback: CDNProviderName): CDNProviderName {
  const raw = process.env[name];
  return raw === "cloudfront" || raw === "cloudflare" || raw === "fastly"
    ? raw
    : fallback;
}

export function loadCDNConfig(): CDNConfiguration {
  const failovers = envList("CDN_FAILOVER_PROVIDERS", []).filter(
    (p): p is CDNProviderName =>
      p === "cloudfront" || p === "cloudflare" || p === "fastly",
  );

  return {
    primary: envProvider("CDN_PRIMARY_PROVIDER", "cloudfront"),
    failovers,
    domains: {
      cloudfront: process.env.CDN_CLOUDFRONT_DOMAIN,
      cloudflare: process.env.CDN_CLOUDFLARE_DOMAIN,
      fastly: process.env.CDN_FASTLY_DOMAIN,
    },
    images: {
      preferredFormats: envList("CDN_IMAGE_FORMATS", [
        "avif",
        "webp",
        "jpeg",
      ]).filter(
        (f): f is ImageDeliveryFormat =>
          f === "avif" || f === "webp" || f === "jpeg" || f === "png",
      ),
      breakpoints: envBreakpoints(),
      quality: envInt("CDN_IMAGE_QUALITY", 80),
      generatePlaceholder: process.env.CDN_IMAGE_PLACEHOLDER !== "false",
      maxSourceBytes: envInt("CDN_IMAGE_MAX_BYTES", 15 * 1024 * 1024),
    },
    edge: {
      enabled: process.env.CDN_EDGE_ENABLED === "true",
      timeoutMs: envInt("CDN_EDGE_TIMEOUT_MS", 50),
      regions: envList("CDN_EDGE_REGIONS", ["global"]),
    },
  };
}

export const cdnConfig = loadCDNConfig();

/**
 * Pick the best format the client will accept.
 *
 * Falls back to the last preferred format when the header is missing or offers
 * only a wildcard — serving AVIF to a client that never said it understands it
 * is how "the images are broken on Safari 14" tickets happen.
 */
export function negotiateImageFormat(
  acceptHeader: string | undefined,
  config: ImageNegotiationConfig = cdnConfig.images,
): ImageDeliveryFormat {
  const fallback =
    config.preferredFormats[config.preferredFormats.length - 1] ?? "jpeg";
  if (!acceptHeader) return fallback;

  const accepted = acceptHeader.toLowerCase();
  for (const format of config.preferredFormats) {
    if (accepted.includes(IMAGE_MIME_TYPES[format])) return format;
  }
  return fallback;
}

/** Public base URL for a provider, or null when it is not configured. */
export function domainFor(
  provider: CDNProviderName,
  config: CDNConfiguration = cdnConfig,
): string | null {
  const domain = config.domains[provider];
  return domain && domain.length > 0 ? domain.replace(/\/+$/, "") : null;
}

/** Providers to try, primary first, skipping any without a configured domain. */
export function providerChain(
  config: CDNConfiguration = cdnConfig,
): CDNProviderName[] {
  const ordered = [config.primary, ...config.failovers];
  const seen = new Set<CDNProviderName>();
  return ordered.filter((provider) => {
    if (seen.has(provider)) return false;
    seen.add(provider);
    return domainFor(provider, config) !== null;
  });
}
