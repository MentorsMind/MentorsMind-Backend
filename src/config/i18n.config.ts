import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';

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
  const languages = acceptLanguage
    .split(',')
    .map(lang => {
      const [code, q] = lang.trim().split(';q=');
      const quality = q ? parseFloat(q) : 1.0;
      return { code: code.split('-')[0], quality };
    })
    .sort((a, b) => b.quality - a.quality);

  // Find first supported language
  for (const { code } of languages) {
    if (supportedLanguages.includes(code as SupportedLanguage)) {
      return code as SupportedLanguage;
    }
  }

  return defaultLanguage;
}

export default i18next;
