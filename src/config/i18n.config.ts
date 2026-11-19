import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import * as path from 'path';
import { logger } from '../utils/logger.utils';

export const supportedLanguages = ['en', 'es', 'fr', 'de', 'zh', 'ja'] as const;
export type SupportedLanguage = typeof supportedLanguages[number];

export const defaultLanguage: SupportedLanguage = 'en';

export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  zh: '中文',
  ja: '日本語',
};

/**
 * Initialize i18next configuration
 */
export async function initializeI18n(): Promise<void> {
  await i18next
    .use(Backend)
    .init({
      lng: defaultLanguage,
      fallbackLng: defaultLanguage,
      supportedLngs: supportedLanguages,
      
      // Backend configuration for loading translation files
      backend: {
        loadPath: path.join(__dirname, '../locales/{{lng}}/{{ns}}.json'),
      },
      
      // Default namespace
      defaultNS: 'common',
      ns: ['common', 'auth', 'bookings', 'notifications', 'emails', 'errors'],
      
      // Interpolation
      interpolation: {
        escapeValue: false, // React already escapes values
      },
      
      // Debug mode (disable in production)
      debug: process.env.NODE_ENV === 'development',
      
      // Save missing keys (useful for development)
      saveMissing: process.env.NODE_ENV === 'development',
      saveMissingTo: 'current',
    });
}

/**
 * Get a translation function for a specific language
 */
export function getTranslationFunction(language: string = defaultLanguage) {
  return i18next.getFixedT(language);
}

/**
 * Get the translation function for the current request language
 */
export function getT(language?: string): ReturnType<typeof i18next.getFixedT> {
  const lng = language && supportedLanguages.includes(language as SupportedLanguage)
    ? language
    : defaultLanguage;
  return i18next.getFixedT(lng);
}

/**
 * Detect language from Accept-Language header
 */
export function detectLanguage(acceptLanguage?: string): SupportedLanguage {
  if (!acceptLanguage) {
    return defaultLanguage;
  }

  // Parse Accept-Language header (e.g., "en-US,en;q=0.9,es;q=0.8")
  let hadMalformedEntry = false;
  const languages = acceptLanguage
    .split(',')
    .map(lang => {
      const [code, q] = lang.trim().split(';q=');
      let quality = 1.0;
      if (q !== undefined) {
        const parsed = parseFloat(q);
        if (isNaN(parsed) || parsed < 0 || parsed > 1) {
          hadMalformedEntry = true;
          quality = 0; // treat malformed quality as lowest priority
        } else {
          quality = parsed;
        }
      }
      return { code: code.split('-')[0], quality };
    })
    .sort((a, b) => b.quality - a.quality);

  if (hadMalformedEntry) {
    logger.warn('Malformed Accept-Language header received; falling back to default language', {
      acceptLanguage,
      defaultLanguage,
    });
  }

  // Find first supported language
  for (const { code } of languages) {
    if (supportedLanguages.includes(code as SupportedLanguage)) {
      return code as SupportedLanguage;
    }
  }

  return defaultLanguage;
}

export default i18next;
