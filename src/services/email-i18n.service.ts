import { getT, SupportedLanguage } from '../config/i18n.config';

/**
 * Email i18n Service
 * Provides translation functions for email templates
 */
export class EmailI18nService {
  /**
   * Get translated email subject
   */
  static getSubject(key: string, language: SupportedLanguage = 'en', options?: any): string {
    const t = getT(language);
    return t(`emails.subject.${key}`, options);
  }

  /**
   * Get translated email greeting
   */
  static getGreeting(type: 'formal' | 'casual' | 'default', name?: string, language: SupportedLanguage = 'en'): string {
    const t = getT(language);
    const greetingKey = `emails.greeting.${type}`;
    if (name) {
      return t(greetingKey, { name });
    }
    return t('emails.greeting.default');
  }

  /**
   * Get translated email closing
   */
  static getClosing(type: 'formal' | 'casual' | 'default', language: SupportedLanguage = 'en'): string {
    const t = getT(language);
    return t(`emails.closing.${type}`);
  }

  /**
   * Get translated email content
   */
  static getContent(key: string, language: SupportedLanguage = 'en', options?: any): string {
    const t = getT(language);
    return t(`emails.${key}`, options);
  }

  /**
   * Get translated email footer
   */
  static getFooter(language: SupportedLanguage = 'en', year?: number): string {
    const t = getT(language);
    return t('emails.footer.copyright', { year: year || new Date().getFullYear() });
  }

  /**
   * Get full translated email structure
   */
  static getEmailStructure(
    templateKey: string,
    language: SupportedLanguage = 'en',
    data?: Record<string, any>
  ): {
    subject: string;
    greeting: string;
    body: string;
    closing: string;
    footer: string;
  } {
    const t = getT(language);
    
    return {
      subject: this.getSubject(templateKey, language, data),
      greeting: this.getGreeting('default', data?.name, language),
      body: this.getContent(templateKey, language, data),
      closing: this.getClosing('default', language),
      footer: this.getFooter(language),
    };
  }
}

export default EmailI18nService;
