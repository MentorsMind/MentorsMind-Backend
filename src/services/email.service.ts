import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import config from '../config';
import { NotificationTemplatesModel } from '../models/notification-templates.model';
import { NotificationDeliveryTrackingModel, DeliveryStatus } from '../models/notification-delivery-tracking.model';
import { logger } from '../utils/logger';

export interface EmailRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  templateId?: string;
  templateData?: Record<string, any>;
  htmlContent?: string;
  textContent?: string;
  priority?: 'high' | 'normal' | 'low';
  trackingId?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  deliveryStatus: DeliveryStatus;
}

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  name: string;
  transporter: Transporter;
  isHealthy: boolean;
  lastError?: string;
  lastErrorTime?: Date;
}

/**
 * Email Service with multiple provider support and circuit breaker pattern
 */
export class EmailService {
  private providers: EmailProvider[] = [];
  private currentProviderIndex = 0;
  private circuitBreakerThreshold = 5;
  private circuitBreakerTimeout = 300000; // 5 minutes

  constructor() {
    this.initializeProviders();
  }

  /**
   * Initialize email providers based on configuration
   */
  private initializeProviders(): void {
    const { smtp, gmail } = config.email;

    // Primary provider: SMTP (Nodemailer)
    if (smtp.host) {
      const smtpTransporter = nodemailer.createTransporter({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
      });

      this.providers.push({
        name: 'SMTP',
        transporter: smtpTransporter,
        isHealthy: true,
      });
    }

    // Fallback provider: Gmail (for development)
    if (gmail.user && gmail.pass) {
      const gmailTransporter = nodemailer.createTransporter({
        service: 'gmail',
        auth: {
          user: gmail.user,
          pass: gmail.pass,
        },
      });

      this.providers.push({
        name: 'Gmail',
        transporter: gmailTransporter,
        isHealthy: true,
      });
    }

    // Default test provider for development
    if (this.providers.length === 0 || config.isDevelopment) {
      const testTransporter = nodemailer.createTransporter({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: 'ethereal.user@ethereal.email',
          pass: 'ethereal.pass',
        },
      });

      this.providers.push({
        name: 'Ethereal',
        transporter: testTransporter,
        isHealthy: true,
      });
    }

    logger.info(`Email service initialized with ${this.providers.length} provider(s)`);
  }

  /**
   * Send email using the best available provider
   */
  async sendEmail(request: EmailRequest): Promise<EmailResult> {
    if (this.providers.length === 0) {
      return {
        success: false,
        error: 'No email providers configured',
        deliveryStatus: DeliveryStatus.FAILED,
      };
    }

    let lastError: string = '';
    
    // Try each provider until one succeeds
    for (let attempt = 0; attempt < this.providers.length; attempt++) {
      const provider = this.getNextHealthyProvider();
      
      if (!provider) {
        return {
          success: false,
          error: 'No healthy email providers available',
          deliveryStatus: DeliveryStatus.FAILED,
        };
      }

      try {
        const result = await this.sendWithProvider(provider, request);
        
        if (result.success) {
          // Reset circuit breaker on success
          provider.isHealthy = true;
          provider.lastError = undefined;
          provider.lastErrorTime = undefined;
          
          return result;
        }
        
        lastError = result.error || 'Unknown error';
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        this.handleProviderError(provider, lastError);
      }
    }

    return {
      success: false,
      error: `All providers failed. Last error: ${lastError}`,
      deliveryStatus: DeliveryStatus.FAILED,
    };
  }

  /**
   * Send email with a specific provider
   */
  private async sendWithProvider(provider: EmailProvider, request: EmailRequest): Promise<EmailResult> {
    try {
      // Render template if templateId is provided
      let subject = request.subject;
      let html = request.htmlContent || '';
      let text = request.textContent || '';

      if (request.templateId) {
        const rendered = await this.renderTemplate(request.templateId, request.templateData || {});
        subject = rendered.subject || request.subject;
        html = rendered.html;
        text = rendered.text;
      }

      const mailOptions: SendMailOptions = {
        from: config.email.fromEmail,
        to: request.to.join(', '),
        cc: request.cc?.join(', '),
        bcc: request.bcc?.join(', '),
        subject,
        html,
        text,
        priority: request.priority || 'normal',
        headers: {
          'X-Tracking-ID': request.trackingId || '',
        },
      };

      const info = await provider.transporter.sendMail(mailOptions);

      // Track delivery if tracking ID is provided
      if (request.trackingId) {
        await NotificationDeliveryTrackingModel.create({
          notification_id: request.trackingId,
          status: DeliveryStatus.SENT,
          channel: 'email',
          provider: provider.name,
          external_id: info.messageId,
          metadata: {
            provider: provider.name,
            messageId: info.messageId,
            response: info.response,
          },
        });
      }

      logger.info(`Email sent successfully via ${provider.name}`, {
        messageId: info.messageId,
        to: request.to,
        subject: request.subject,
      });

      return {
        success: true,
        messageId: info.messageId,
        deliveryStatus: DeliveryStatus.SENT,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Track delivery failure if tracking ID is provided
      if (request.trackingId) {
        await NotificationDeliveryTrackingModel.create({
          notification_id: request.trackingId,
          status: DeliveryStatus.FAILED,
          channel: 'email',
          provider: provider.name,
          error_message: errorMessage,
          metadata: {
            provider: provider.name,
            error: errorMessage,
          },
        });
      }

      logger.error(`Email failed via ${provider.name}`, { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        deliveryStatus: DeliveryStatus.FAILED,
      };
    }
  }

  /**
   * Render email template with data
   */
  async renderTemplate(templateId: string, data: Record<string, any>): Promise<RenderedTemplate> {
    try {
      const template = await NotificationTemplatesModel.getById(templateId);
      
      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }

      // Simple template variable replacement
      let subject = template.subject || '';
      let html = template.html_content;
      let text = template.text_content;

      // Replace variables in the format {{variable}}
      Object.entries(data).forEach(([key, value]) => {
        const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        const stringValue = String(value);
        
        subject = subject.replace(placeholder, stringValue);
        html = html.replace(placeholder, stringValue);
        text = text.replace(placeholder, stringValue);
      });

      return { subject, html, text };
    } catch (error) {
      logger.error('Failed to render email template', { error });
      
      // Return fallback template
      return {
        subject: 'Notification from MentorMinds',
        html: '<p>You have a new notification from MentorMinds.</p>',
        text: 'You have a new notification from MentorMinds.',
      };
    }
  }

  /**
   * Validate template with sample data
   */
  async validateTemplate(templateId: string, sampleData: Record<string, any>): Promise<boolean> {
    try {
      const template = await NotificationTemplatesModel.getById(templateId);
      
      if (!template) {
        return false;
      }

      // Check if all required variables are provided
      const missingVariables = template.variables.filter(
        variable => !(variable in sampleData)
      );

      if (missingVariables.length > 0) {
        logger.warn(`Template ${templateId} missing variables`, { missingVariables });
        return false;
      }

      // Try to render the template
      await this.renderTemplate(templateId, sampleData);
      return true;
    } catch (error) {
      logger.error(`Template validation failed for ${templateId}`, { error });
      return false;
    }
  }

  /**
   * Get next healthy provider using round-robin with circuit breaker
   */
  private getNextHealthyProvider(): EmailProvider | null {
    const startIndex = this.currentProviderIndex;
    
    do {
      const provider = this.providers[this.currentProviderIndex];
      this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
      
      if (this.isProviderHealthy(provider)) {
        return provider;
      }
    } while (this.currentProviderIndex !== startIndex);
    
    return null;
  }

  /**
   * Check if provider is healthy (circuit breaker logic)
   */
  private isProviderHealthy(provider: EmailProvider): boolean {
    if (provider.isHealthy) {
      return true;
    }

    // Check if circuit breaker timeout has passed
    if (provider.lastErrorTime) {
      const timeSinceError = Date.now() - provider.lastErrorTime.getTime();
      if (timeSinceError > this.circuitBreakerTimeout) {
        provider.isHealthy = true;
        provider.lastError = undefined;
        provider.lastErrorTime = undefined;
        logger.info(`Provider ${provider.name} circuit breaker reset`);
        return true;
      }
    }

    return false;
  }

  /**
   * Handle provider error (circuit breaker logic)
   */
  private handleProviderError(provider: EmailProvider, error: string): void {
    provider.lastError = error;
    provider.lastErrorTime = new Date();
    provider.isHealthy = false;
    
    logger.warn(`Provider ${provider.name} marked as unhealthy`, { error });
  }

  /**
   * Get provider health status
   */
  getProviderStatus(): { name: string; healthy: boolean; lastError?: string }[] {
    return this.providers.map(provider => ({
      name: provider.name,
      healthy: this.isProviderHealthy(provider),
      lastError: provider.lastError,
    }));
  }

  /**
   * Test email connectivity
   */
  async testConnection(): Promise<{ provider: string; success: boolean; error?: string }[]> {
    const results = [];
    
    for (const provider of this.providers) {
      try {
        await provider.transporter.verify();
        results.push({
          provider: provider.name,
          success: true,
        });
      } catch (error) {
        results.push({
          provider: provider.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    
    return results;
  }

  /**
   * Send test email
   */
  async sendTestEmail(to: string): Promise<EmailResult> {
    return this.sendEmail({
      to: [to],
      subject: 'MentorMinds Email Service Test',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4A90E2;">Email Service Test</h2>
          <p>This is a test email from the MentorMinds notification system.</p>
          <p>If you received this email, the email service is working correctly.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;" />
          <p style="color: #666; font-size: 14px;">
            Sent at: ${new Date().toISOString()}<br>
            From: MentorMinds Email Service
          </p>
        </div>
      `,
      textContent: `
        Email Service Test
        
        This is a test email from the MentorMinds notification system.
        If you received this email, the email service is working correctly.
        
        Sent at: ${new Date().toISOString()}
        From: MentorMinds Email Service
      `,
    });
  }
}

// Export singleton instance
export const emailService = new EmailService();
export default emailService;