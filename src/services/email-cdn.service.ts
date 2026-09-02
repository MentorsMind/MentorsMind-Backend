/**
 * Email CDN Asset Service — Issue #752
 *
 * Provides CDN-backed URL resolution for email template assets (logos, icons,
 * images). Email clients such as Outlook and many corporate mail clients block
 * external image loading from arbitrary origins, so all asset references in
 * Handlebars templates must resolve to absolute, CDN-hosted, publicly cacheable
 * URLs with long TTLs and proper cache-control headers.
 *
 * This service:
 *  1. Converts relative asset paths to absolute CDN URLs via CDNService.
 *  2. Injects a full set of CDN-resolved template variables into every email
 *     render call (logoUrl, social icon URLs, etc.).
 *  3. Exposes helper functions that the TemplateEngineService can call before
 *     rendering a Handlebars template so no template file needs to hard-code
 *     external URLs directly.
 *  4. Falls back gracefully to a configurable APP_BASE_URL when CDN is not
 *     configured, so local/test environments still produce valid absolute URLs.
 */

import { env } from "../config/env";
import { CDNService } from "./cdn.service";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Asset path constants — paths relative to the CDN / static root
// ---------------------------------------------------------------------------

/** Paths for brand assets served from the CDN */
export const EMAIL_ASSET_PATHS = {
  logo: "/assets/emails/logo.png",
  logoWhite: "/assets/emails/logo-white.png",
  /** Social icon paths — hosted on our CDN, not a third-party icon CDN */
  twitterIcon: "/assets/emails/icons/twitter.png",
  linkedinIcon: "/assets/emails/icons/linkedin.png",
  facebookIcon: "/assets/emails/icons/facebook.png",
  instagramIcon: "/assets/emails/icons/instagram.png",
  /** Generic status icons used by transactional templates */
  checkIcon: "/assets/emails/icons/check.png",
  warningIcon: "/assets/emails/icons/warning.png",
  calendarIcon: "/assets/emails/icons/calendar.png",
  avatarPlaceholder: "/assets/emails/avatar-placeholder.png",
} as const;

export type EmailAssetKey = keyof typeof EMAIL_ASSET_PATHS;

// ---------------------------------------------------------------------------
// URL resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve an asset path to an absolute URL using the configured CDN.
 * Falls back to APP_BASE_URL when CDN is not available so templates always
 * produce absolute (not relative) URLs — required by email clients.
 */
async function resolveAssetUrl(assetPath: string): Promise<string> {
  // If CDN is configured, use it
  const cdnUrl = await CDNService.getAssetUrl(assetPath);
  if (cdnUrl !== assetPath) {
    return cdnUrl;
  }

  // Fallback: prefix with APP_BASE_URL for absolute URL without CDN
  const base = (env.CDN_BASE_URL || env.APP_BASE_URL || "").replace(/\/$/, "");
  const path = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;
  return `${base}${path}`;
}

function resolveAssetUrlSync(assetPath: string): string {
  // Synchronous fallback for Handlebars helpers - only uses base URL
  const base = (env.CDN_BASE_URL || env.APP_BASE_URL || "").replace(/\/$/, "");
  const path = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;
  return `${base}${path}`;
}

/**
 * Resolve a named email asset to its absolute CDN URL.
 */
async function resolveEmailAsset(key: EmailAssetKey): Promise<string> {
  return await resolveAssetUrl(EMAIL_ASSET_PATHS[key]);
}

function resolveEmailAssetSync(key: EmailAssetKey): string {
  return resolveAssetUrlSync(EMAIL_ASSET_PATHS[key]);
}

// ---------------------------------------------------------------------------
// Template variable injection
// ---------------------------------------------------------------------------

export interface EmailCDNVariables {
  /** Absolute CDN URL for the MentorMinds logo (used in the header) */
  logoUrl: string;
  /** Absolute CDN URL for the white variant of the logo */
  logoWhiteUrl: string;
  /** Social icon CDN URLs */
  twitterIconUrl: string;
  linkedinIconUrl: string;
  facebookIconUrl: string;
  instagramIconUrl: string;
  /** Generic icon CDN URLs */
  checkIconUrl: string;
  warningIconUrl: string;
  calendarIconUrl: string;
  /** Avatar placeholder used when user has no profile picture */
  avatarPlaceholderUrl: string;
  /** Platform / footer link URLs from env */
  platformUrl: string;
  supportUrl: string;
  privacyUrl: string;
  termsUrl: string;
  /** The current 4-digit year for copyright footers */
  currentYear: number;
  /** Company address from env for CAN-SPAM / GDPR compliance */
  companyAddress: string;
}

/**
 * Build a complete set of CDN-resolved template variables that should be
 * merged into every email render's data object.
 *
 * Usage in TemplateEngineService:
 *   const cdnVars = EmailCDNService.getTemplateVariables();
 *   const data = { ...cdnVars, ...userProvidedData };
 *   const html = await hbs.render(templatePath, data);
 */
async function getTemplateVariables(): Promise<EmailCDNVariables> {
  const vars: EmailCDNVariables = {
    logoUrl: await resolveEmailAsset("logo"),
    logoWhiteUrl: await resolveEmailAsset("logoWhite"),
    twitterIconUrl: await resolveEmailAsset("twitterIcon"),
    linkedinIconUrl: await resolveEmailAsset("linkedinIcon"),
    facebookIconUrl: await resolveEmailAsset("facebookIcon"),
    instagramIconUrl: await resolveEmailAsset("instagramIcon"),
    checkIconUrl: await resolveEmailAsset("checkIcon"),
    warningIconUrl: await resolveEmailAsset("warningIcon"),
    calendarIconUrl: await resolveEmailAsset("calendarIcon"),
    avatarPlaceholderUrl: await resolveEmailAsset("avatarPlaceholder"),
    platformUrl: env.APP_CLIENT_URL || env.FRONTEND_URL || env.APP_BASE_URL,
    supportUrl: `${env.APP_CLIENT_URL || env.APP_BASE_URL}/support`,
    privacyUrl: `${env.APP_CLIENT_URL || env.APP_BASE_URL}/privacy`,
    termsUrl: `${env.APP_CLIENT_URL || env.APP_BASE_URL}/terms`,
    currentYear: new Date().getFullYear(),
    companyAddress:
      process.env.COMPANY_ADDRESS || "MentorMinds, Inc. — mentorminds.com",
  };

  logger.debug("Email CDN template variables resolved", {
    cdnConfigured: !!CDNService.getConfig(),
    logoUrl: vars.logoUrl,
  });

  return vars;
}

// ---------------------------------------------------------------------------
// Handlebars helper registration
// ---------------------------------------------------------------------------

/**
 * Register a Handlebars helper `cdnAsset` that templates can call as:
 *   {{cdnAsset "logo"}}
 *   {{cdnAsset "twitterIcon"}}
 *
 * Also registers `cdnUrl` for arbitrary CDN-resolved paths:
 *   {{cdnUrl "/images/hero.jpg"}}
 *
 * @param hbs - A Handlebars environment instance (e.g. from `handlebars` or
 *              `express-handlebars`).
 */
function registerHandlebarsHelpers(hbs: {
  registerHelper: (name: string, fn: (...args: unknown[]) => string) => void;
}): void {
  hbs.registerHelper("cdnAsset", (key: unknown): string => {
    if (typeof key !== "string" || !(key in EMAIL_ASSET_PATHS)) {
      logger.warn("cdnAsset helper called with unknown key", { key });
      return "";
    }
    return resolveEmailAssetSync(key as EmailAssetKey);
  });

  hbs.registerHelper("cdnUrl", (path: unknown): string => {
    if (typeof path !== "string") {
      logger.warn("cdnUrl helper called with non-string path", { path });
      return "";
    }
    return resolveAssetUrlSync(path);
  });

  logger.debug("Handlebars CDN helpers registered: cdnAsset, cdnUrl");
}

// ---------------------------------------------------------------------------
// Social icons mapping — replaces hard-coded Flaticon URLs in templates
// ---------------------------------------------------------------------------

/**
 * Returns a mapping of social-icon template variable names to their CDN URLs.
 * These replace the hard-coded `https://cdn-icons-png.flaticon.com/…` URLs
 * in base-layout.hbs so corporate email clients that block third-party image
 * CDNs will still render the icons.
 */
async function getSocialIconVariables(): Promise<Record<string, string>> {
  return {
    twitterIconUrl: await resolveEmailAsset("twitterIcon"),
    linkedinIconUrl: await resolveEmailAsset("linkedinIcon"),
    facebookIconUrl: await resolveEmailAsset("facebookIcon"),
    instagramIconUrl: await resolveEmailAsset("instagramIcon"),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const EmailCDNService = {
  resolveAssetUrl,
  resolveEmailAsset,
  getTemplateVariables,
  registerHandlebarsHelpers,
  getSocialIconVariables,
};
