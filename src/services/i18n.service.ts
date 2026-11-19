import i18next from "i18next";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";
import {
  supportedLanguages,
  SupportedLanguage,
  defaultLanguage,
} from "../config/i18n.config";

export interface TranslationEntry {
  key: string;
  value: string;
  language: SupportedLanguage;
  namespace: string;
}

export interface RTLConfig {
  isRTL: boolean;
  direction: "ltr" | "rtl";
  textAlignment: "left" | "right";
}

// RTL language codes
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

/**
 * Check if a language is RTL (Right-to-Left)
 */
export function isRTLLanguage(lang: string): boolean {
  return RTL_LANGUAGES.has(lang.toLowerCase());
}

/**
 * Get RTL configuration for a language
 */
export function getRTLConfig(lang: string): RTLConfig {
  const isRTL = isRTLLanguage(lang);
  return {
    isRTL,
    direction: isRTL ? "rtl" : "ltr",
    textAlignment: isRTL ? "right" : "left",
  };
}

/**
 * Get all supported languages with their metadata
 */
export function getSupportedLanguages(): Array<{
  code: SupportedLanguage;
  name: string;
  isRTL: boolean;
  direction: "ltr" | "rtl";
}> {
  const languageNames: Record<SupportedLanguage, string> = {
    en: "English",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
    zh: "中文",
    ja: "日本語",
  };

  return supportedLanguages.map((code) => ({
    code,
    name: languageNames[code],
    isRTL: isRTLLanguage(code),
    direction: isRTLLanguage(code) ? "rtl" as const : "ltr" as const,
  }));
}

/**
 * Get a translation for a specific key and language
 */
export function getTranslation(
  key: string,
  language: string = defaultLanguage,
  namespace: string = "common",
  options?: Record<string, any>,
): string {
  const lang = supportedLanguages.includes(language as SupportedLanguage)
    ? language
    : defaultLanguage;

  const t = i18next.getFixedT(lang, namespace);
  return t(key, options);
}

/**
 * Get all translations for a language and namespace
 */
export function getTranslations(
  language: string = defaultLanguage,
  namespace: string = "common",
): Record<string, string> {
  const lang = supportedLanguages.includes(language as SupportedLanguage)
    ? language
    : defaultLanguage;

  const bundle = i18next.getResourceBundle(lang, namespace);
  return bundle || {};
}

/**
 * Check if a translation key exists
 */
export function hasTranslation(
  key: string,
  language: string = defaultLanguage,
  namespace: string = "common",
): boolean {
  const lang = supportedLanguages.includes(language as SupportedLanguage)
    ? language
    : defaultLanguage;

  return i18next.exists(key, { lng: lang, ns: namespace });
}

/**
 * Detect the best language from Accept-Language header
 */
export function detectPreferredLanguage(acceptLanguage?: string): SupportedLanguage {
  if (!acceptLanguage) return defaultLanguage;

  const languages = acceptLanguage
    .split(",")
    .map((lang) => {
      const [code, q] = lang.trim().split(";q=");
      const quality = q ? parseFloat(q) : 1.0;
      return { code: code.split("-")[0].toLowerCase(), quality };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const { code } of languages) {
    if (supportedLanguages.includes(code as SupportedLanguage)) {
      return code as SupportedLanguage;
    }
  }

  return defaultLanguage;
}

/**
 * Format a number according to locale conventions
 */
export function formatNumber(
  value: number,
  language: string = defaultLanguage,
  options?: Intl.NumberFormatOptions,
): string {
  const locale = language === "zh" ? "zh-CN" : language;
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Format a date according to locale conventions
 */
export function formatDate(
  date: Date | string,
  language: string = defaultLanguage,
  options?: Intl.DateTimeFormatOptions,
): string {
  const locale = language === "zh" ? "zh-CN" : language;
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, options).format(d);
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(
  date: Date | string,
  language: string = defaultLanguage,
): string {
  const locale = language === "zh" ? "zh-CN" : language;
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (diffSec < 60) return rtf.format(-diffSec, "second");
  if (diffMin < 60) return rtf.format(-diffMin, "minute");
  if (diffHour < 24) return rtf.format(-diffHour, "hour");
  return rtf.format(-diffDay, "day");
}

/**
 * Get locale-aware text direction attribute value
 */
export function getTextDirection(language: string = defaultLanguage): "ltr" | "rtl" {
  return isRTLLanguage(language) ? "rtl" : "ltr";
}

/**
 * Get CSS class for text direction
 */
export function getDirectionClass(language: string = defaultLanguage): string {
  return isRTLLanguage(language) ? "rtl" : "ltr";
}

export const I18nService = {
  isRTLLanguage,
  getRTLConfig,
  getSupportedLanguages,
  getTranslation,
  getTranslations,
  hasTranslation,
  detectPreferredLanguage,
  formatNumber,
  formatDate,
  formatRelativeTime,
  getTextDirection,
  getDirectionClass,
};
