import { getT, SupportedLanguage } from '../config/i18n.config';

/**
 * Notification i18n Service
 * Provides translation functions for notification messages
 */
export class NotificationI18nService {
  /**
   * Get translated notification title
   */
  static getTitle(type: string, language: SupportedLanguage = 'en', options?: any): string {
    const t = getT(language);
    return t(`notifications.types.${type}`, options);
  }

  /**
   * Get translated notification message
   */
  static getMessage(key: string, language: SupportedLanguage = 'en', options?: any): string {
    const t = getT(language);
    return t(`notifications.messages.${key}`, options);
  }

  /**
   * Get translated notification action label
   */
  static getAction(action: string, language: SupportedLanguage = 'en'): string {
    const t = getT(language);
    return t(`notifications.actions.${action}`);
  }

  /**
   * Get translated notification setting label
   */
  static getSetting(setting: string, language: SupportedLanguage = 'en'): string {
    const t = getT(language);
    return t(`notifications.settings.${setting}`);
  }

  /**
   * Get full translated notification structure
   */
  static getNotificationStructure(
    messageKey: string,
    language: SupportedLanguage = 'en',
    data?: Record<string, any>
  ): {
    title: string;
    message: string;
  } {
    const t = getT(language);
    
    // Extract type from message key (e.g., "bookingCreated" -> "booking.created")
    const parts = messageKey.split(/(?=[A-Z])/).map((p, i) => i === 0 ? p : p.toLowerCase()).join('');
    const typeKey = parts.replace(/([A-Z])/g, '.$1').toLowerCase();
    
    return {
      title: this.getTitle(typeKey, language),
      message: this.getMessage(messageKey, language, data),
    };
  }

  /**
   * Get translated error message
   */
  static getError(category: string, key: string, language: SupportedLanguage = 'en', options?: any): string {
    const t = getT(language);
    return t(`errors.${category}.${key}`, options);
  }

  /**
   * Get translated validation error
   */
  static getValidationError(key: string, language: SupportedLanguage = 'en', options?: any): string {
    const t = getT(language);
    return t(`errors.validation.${key}`, options);
  }
}

export default NotificationI18nService;
