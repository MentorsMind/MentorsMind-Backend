import { NotificationTemplatesModel, NotificationTemplateRecord } from '../models/notification-templates.model';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';

export interface RenderedEmail {
  subject: string;
  htmlContent: string;
  textContent: string;
}

export interface RenderedNotification {
  title: string;
  message: string;
  data: Record<string, any>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface Template {
  id: string;
  name: string;
  type: 'email' | 'in_app';
  subject?: string;
  htmlContent: string;
  textContent: string;
  variables: string[];
  isActive: boolean;
}

/**
 * Simple template cache using in-memory storage
 * In production, this could be replaced with Redis
 */
class TemplateCache {
  private cache = new Map<string, { template: NotificationTemplateRecord; timestamp: number }>();
  private readonly TTL = 5 * 60 * 1000; // 5 minutes

  set(key: string, template: NotificationTemplateRecord): void {
    this.cache.set(key, {
      template,
      timestamp: Date.now(),
    });
  }

  get(key: string): NotificationTemplateRecord | null {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    // Check if cache entry is expired
    if (Date.now() - cached.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.template;
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Template Engine Service for rendering email and in-app notifications
 */
export const TemplateEngineService = {
  cache: new TemplateCache(),

  /**
   * Render email template with data
   */
  async renderEmail(templateId: string, data: any): Promise<RenderedEmail> {
    try {
      const template = await this.getTemplate(templateId);
      
      if (!template || template.type !== 'email') {
        logger.warn(`Email template ${templateId} not found, using fallback`);
        return this.getFallbackEmailTemplate(data);
      }

      const subject = this.interpolateTemplate(template.subject || 'Notification', data);
      const htmlContent = this.interpolateTemplate(template.html_content, data);
      const textContent = this.interpolateTemplate(template.text_content, data);

      return {
        subject: this.sanitizeOutput(subject),
        htmlContent: this.sanitizeHtml(htmlContent),
        textContent: this.sanitizeOutput(textContent),
      };
    } catch (error) {
      logger.error('Failed to render email template:', error);
      return this.getFallbackEmailTemplate(data);
    }
  },

  /**
   * Render in-app notification template with data
   */
  async renderInApp(templateId: string, data: any): Promise<RenderedNotification> {
    try {
      const template = await this.getTemplate(templateId);
      
      if (!template || template.type !== 'in_app') {
        logger.warn(`In-app template ${templateId} not found, using fallback`);
        return this.getFallbackInAppTemplate(data);
      }

      const title = this.interpolateTemplate(template.subject || 'Notification', data);
      const message = this.interpolateTemplate(template.text_content, data);

      return {
        title: this.sanitizeOutput(title),
        message: this.sanitizeOutput(message),
        data: data || {},
      };
    } catch (error) {
      logger.error('Failed to render in-app template:', error);
      return this.getFallbackInAppTemplate(data);
    }
  },

  /**
   * Validate template syntax and variables
   */
  async validateTemplate(template: Template): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      // Validate required fields
      if (!template.id || !template.name) {
        result.errors.push('Template ID and name are required');
        result.isValid = false;
      }

      if (!template.htmlContent && !template.textContent) {
        result.errors.push('Template must have either HTML or text content');
        result.isValid = false;
      }

      // Validate template syntax
      const syntaxErrors = this.validateTemplateSyntax(template.htmlContent);
      if (syntaxErrors.length > 0) {
        result.errors.push(...syntaxErrors);
        result.isValid = false;
      }

      // Check for undefined variables
      const undefinedVars = this.findUndefinedVariables(template);
      if (undefinedVars.length > 0) {
        result.warnings.push(`Undefined variables found: ${undefinedVars.join(', ')}`);
      }

      // Validate HTML content for XSS vulnerabilities
      if (template.htmlContent) {
        const xssWarnings = this.checkForXssVulnerabilities(template.htmlContent);
        if (xssWarnings.length > 0) {
          result.warnings.push(...xssWarnings);
        }
      }

    } catch (error) {
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.isValid = false;
    }

    return result;
  },

  /**
   * Cache template for faster access
   */
  async cacheTemplate(templateId: string): Promise<void> {
    try {
      const template = await NotificationTemplatesModel.getById(templateId);
      if (template) {
        this.cache.set(templateId, template);
      }
    } catch (error) {
      logger.error(`Failed to cache template ${templateId}:`, error);
    }
  },

  /**
   * Get template from cache or database
   */
  async getTemplate(templateId: string): Promise<NotificationTemplateRecord | null> {
    // Try cache first
    let template = this.cache.get(templateId);
    
    if (!template) {
      // Load from database
      template = await NotificationTemplatesModel.getById(templateId);
      if (template) {
        this.cache.set(templateId, template);
      }
    }

    return template;
  },

  /**
   * Interpolate template with data using simple variable substitution
   */
  interpolateTemplate(template: string, data: any): string {
    if (!template || !data) {
      return template || '';
    }

    return template.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
      const value = this.getNestedValue(data, variable);
      return value !== undefined ? String(value) : match;
    });
  },

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  },

  /**
   * Sanitize output to prevent XSS attacks
   */
  sanitizeOutput(input: string): string {
    if (!input) return '';
    
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },

  /**
   * Sanitize HTML content while preserving safe tags
   */
  sanitizeHtml(html: string): string {
    if (!html) return '';

    // Allow only safe HTML tags and attributes
    const allowedTags = ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'a'];
    const allowedAttributes = ['href', 'style', 'class'];

    // Simple HTML sanitization (in production, use a library like DOMPurify)
    let sanitized = html;

    // Remove script tags and their content
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove dangerous event handlers
    sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    
    // Remove javascript: URLs
    sanitized = sanitized.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');

    return sanitized;
  },

  /**
   * Validate template syntax for common issues
   */
  validateTemplateSyntax(template: string): string[] {
    const errors: string[] = [];

    if (!template) return errors;

    // Check for unmatched braces
    const openBraces = (template.match(/\{\{/g) || []).length;
    const closeBraces = (template.match(/\}\}/g) || []).length;
    
    if (openBraces !== closeBraces) {
      errors.push('Unmatched template braces {{ }}');
    }

    // Check for nested braces (not supported in simple implementation)
    if (template.includes('{{{') || template.includes('}}}')) {
      errors.push('Nested braces are not supported');
    }

    // Check for empty variable names
    if (template.includes('{{}}')) {
      errors.push('Empty variable names are not allowed');
    }

    return errors;
  },

  /**
   * Find variables used in template that are not defined
   */
  findUndefinedVariables(template: Template): string[] {
    const usedVariables = new Set<string>();
    const definedVariables = new Set(template.variables || []);

    // Extract variables from all template content
    const contents = [
      template.subject || '',
      template.htmlContent || '',
      template.textContent || '',
    ].join(' ');

    const variableMatches = contents.match(/\{\{(\w+)\}\}/g);
    if (variableMatches) {
      variableMatches.forEach(match => {
        const variable = match.replace(/\{\{|\}\}/g, '');
        usedVariables.add(variable);
      });
    }

    return Array.from(usedVariables).filter(variable => !definedVariables.has(variable));
  },

  /**
   * Check for potential XSS vulnerabilities in HTML content
   */
  checkForXssVulnerabilities(html: string): string[] {
    const warnings: string[] = [];

    if (!html) return warnings;

    // Check for script tags
    if (/<script/i.test(html)) {
      warnings.push('Script tags detected in HTML content');
    }

    // Check for event handlers
    if (/\s*on\w+\s*=/i.test(html)) {
      warnings.push('Event handlers detected in HTML content');
    }

    // Check for javascript: URLs
    if (/javascript:/i.test(html)) {
      warnings.push('JavaScript URLs detected in HTML content');
    }

    // Check for data: URLs
    if (/data:/i.test(html)) {
      warnings.push('Data URLs detected in HTML content');
    }

    return warnings;
  },

  /**
   * Get fallback email template
   */
  getFallbackEmailTemplate(data: any): RenderedEmail {
    const name = data?.name || data?.user?.name || 'User';
    
    return {
      subject: 'Notification from MentorMinds',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4A90E2;">Hello ${this.sanitizeOutput(name)}</h2>
          <p>You have a new notification from MentorMinds.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;" />
          <p style="color: #666; font-size: 14px;">Best regards,<br>The MentorMinds Team</p>
        </div>
      `,
      textContent: `Hello ${this.sanitizeOutput(name)}\n\nYou have a new notification from MentorMinds.\n\nBest regards,\nThe MentorMinds Team`,
    };
  },

  /**
   * Get fallback in-app template
   */
  getFallbackInAppTemplate(data: any): RenderedNotification {
    return {
      title: 'New Notification',
      message: 'You have a new notification.',
      data: data || {},
    };
  },

  /**
   * Clear template cache
   */
  clearCache(): void {
    this.cache.clear();
  },

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size(),
      ttl: 5 * 60 * 1000, // 5 minutes in milliseconds
    };
  },

  /**
   * Preload commonly used templates
   */
  async preloadTemplates(templateIds: string[]): Promise<void> {
    const promises = templateIds.map(id => this.cacheTemplate(id));
    await Promise.all(promises);
  },

  /**
   * Generate template hash for versioning
   */
  generateTemplateHash(template: Template): string {
    const content = JSON.stringify({
      subject: template.subject,
      htmlContent: template.htmlContent,
      textContent: template.textContent,
    });
    
    return createHash('md5').update(content).digest('hex');
  },
};