import config from "../config";
import { NotificationTemplatesModel } from "../models/notification-templates.model";
import {
  NotificationDeliveryTrackingModel,
  DeliveryStatus,
} from "../models/notification-delivery-tracking.model";
import { logger } from "../utils/logger";
import https from "https";

export interface EmailRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  templateId?: string;
  templateData?: Record<string, any>;
  htmlContent?: string;
  textContent?: string;
  priority?: "high" | "normal" | "low";
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

export interface IEmailProvider {
  name: string;
  isHealthy: boolean;
  lastError?: string;
  lastErrorTime?: Date;
  send(
    request: EmailRequest,
    rendered: RenderedTemplate,
  ): Promise<{ messageId: string }>;
}

// ---------------------------------------------------------------------------
// SendGrid provider
// ---------------------------------------------------------------------------
class SendGridProvider implements IEmailProvider {
  name = "SendGrid";
  isHealthy = true;
  lastError?: string;
  lastErrorTime?: Date;

  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(
    request: EmailRequest,
    rendered: RenderedTemplate,
  ): Promise<{ messageId: string }> {
    const payload = JSON.stringify({
      personalizations: [
        {
          to: request.to.map((email) => ({ email })),
          ...(request.cc?.length && {
            cc: request.cc.map((email) => ({ email })),
          }),
          ...(request.bcc?.length && {
            bcc: request.bcc.map((email) => ({ email })),
          }),
          subject: rendered.subject,
        },
      ],
      from: { email: config.email.fromEmail },
      subject: rendered.subject,
      content: [
        { type: "text/plain", value: rendered.text || rendered.subject },
        { type: "text/html", value: rendered.html || rendered.subject },
      ],
      tracking_settings: {
        click_tracking: { enable: true },
        open_tracking: { enable: true },
      },
      ...(request.trackingId && {
        custom_args: { tracking_id: request.trackingId },
      }),
    });

    const response = await this.httpPost(
      "https://api.sendgrid.com/v3/mail/send",
      payload,
      {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `SendGrid API error ${response.statusCode}: ${response.body}`,
      );
    }

    // SendGrid returns message ID in X-Message-Id header
    const messageId = response.headers["x-message-id"] || `sg-${Date.now()}`;
    return { messageId: Array.isArray(messageId) ? messageId[0] : messageId };
  }

  private httpPost(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<{
    statusCode: number;
    body: string;
    headers: Record<string, string | string[]>;
  }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode || 0,
            body: data,
            headers: res.headers as Record<string, string | string[]>,
          }),
        );
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// Mailgun provider
// ---------------------------------------------------------------------------
class MailgunProvider implements IEmailProvider {
  name = "Mailgun";
  isHealthy = true;
  lastError?: string;
  lastErrorTime?: Date;

  private readonly apiKey: string;
  private readonly domain: string;
  private readonly host: string;

  constructor(apiKey: string, domain: string, host = "api.mailgun.net") {
    this.apiKey = apiKey;
    this.domain = domain;
    this.host = host;
  }

  async send(
    request: EmailRequest,
    rendered: RenderedTemplate,
  ): Promise<{ messageId: string }> {
    const params = new URLSearchParams();
    params.append("from", config.email.fromEmail);
    request.to.forEach((t) => params.append("to", t));
    if (request.cc) request.cc.forEach((c) => params.append("cc", c));
    if (request.bcc) request.bcc.forEach((b) => params.append("bcc", b));
    params.append("subject", rendered.subject);
    params.append("html", rendered.html || rendered.subject);
    params.append("text", rendered.text || rendered.subject);
    if (request.trackingId) {
      params.append("v:tracking_id", request.trackingId);
    }
    params.append("o:tracking", "yes");
    params.append("o:tracking-clicks", "yes");
    params.append("o:tracking-opens", "yes");

    const body = params.toString();
    const auth = Buffer.from(`api:${this.apiKey}`).toString("base64");

    const response = await this.httpPost(
      `https://${this.host}/v3/${this.domain}/messages`,
      body,
      {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `Mailgun API error ${response.statusCode}: ${response.body}`,
      );
    }

    const parsed = JSON.parse(response.body);
    return { messageId: parsed.id || `mg-${Date.now()}` };
  }

  private httpPost(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () =>
          resolve({ statusCode: res.statusCode || 0, body: data }),
        );
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// SMTP fallback provider (nodemailer-free, raw SMTP via net/tls)
// Uses a minimal inline SMTP client to avoid nodemailer dependency.
// For production, prefer SendGrid or Mailgun.
// ---------------------------------------------------------------------------
class SmtpProvider implements IEmailProvider {
  name = "SMTP";
  isHealthy = true;
  lastError?: string;
  lastErrorTime?: Date;

  async send(
    request: EmailRequest,
    rendered: RenderedTemplate,
  ): Promise<{ messageId: string }> {
    // Lazy-load nodemailer only when SMTP is actually used
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require("nodemailer");
    const { smtp, gmail, fromEmail } = config.email;

    let transportConfig: any;

    if (smtp.host) {
      transportConfig = {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        pool: true,
        maxConnections: 5,
      };
    } else if (gmail.user && gmail.pass) {
      transportConfig = {
        service: "gmail",
        auth: { user: gmail.user, pass: gmail.pass },
      };
    } else {
      transportConfig = {
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user: "ethereal.user@ethereal.email", pass: "ethereal.pass" },
      };
    }

    const transporter = nodemailer.createTransport(transportConfig);
    const info = await transporter.sendMail({
      from: fromEmail,
      to: request.to.join(", "),
      cc: request.cc?.join(", "),
      bcc: request.bcc?.join(", "),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: request.trackingId
        ? { "X-Tracking-ID": request.trackingId }
        : {},
    });

    return { messageId: info.messageId };
  }
}

// ---------------------------------------------------------------------------
// EmailService — circuit-breaker + provider failover
// ---------------------------------------------------------------------------
export class EmailService {
  private providers: IEmailProvider[] = [];
  private currentProviderIndex = 0;
  private readonly circuitBreakerTimeout = 300_000; // 5 minutes

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const { provider, sendgrid, mailgun } = config.email;

    if (provider === "sendgrid" && sendgrid.apiKey) {
      this.providers.push(new SendGridProvider(sendgrid.apiKey));
    } else if (provider === "mailgun" && mailgun.apiKey && mailgun.domain) {
      this.providers.push(
        new MailgunProvider(mailgun.apiKey, mailgun.domain, mailgun.host),
      );
    }

    // Always add SMTP as final fallback
    this.providers.push(new SmtpProvider());

    logger.info(`Email service initialized`, {
      primary: provider,
      providers: this.providers.map((p) => p.name),
    });
  }

  async sendEmail(request: EmailRequest): Promise<EmailResult> {
    if (this.providers.length === 0) {
      return {
        success: false,
        error: "No email providers configured",
        deliveryStatus: DeliveryStatus.FAILED,
      };
    }

    let lastError = "";

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.getNextHealthyProvider();
      if (!provider) {
        return {
          success: false,
          error: "No healthy email providers available",
          deliveryStatus: DeliveryStatus.FAILED,
        };
      }

      try {
        const rendered = await this.renderContent(request);
        const { messageId } = await provider.send(request, rendered);

        // Reset circuit breaker on success
        provider.isHealthy = true;
        provider.lastError = undefined;
        provider.lastErrorTime = undefined;

        if (request.trackingId) {
          await NotificationDeliveryTrackingModel.create({
            notification_id: request.trackingId,
            status: DeliveryStatus.SENT,
            channel: "email",
            provider: provider.name,
            external_id: messageId,
            metadata: { provider: provider.name, messageId },
          });
        }

        logger.info("Email sent", {
          provider: provider.name,
          messageId,
          to: request.to,
        });
        return {
          success: true,
          messageId,
          deliveryStatus: DeliveryStatus.SENT,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown error";
        this.handleProviderError(provider, lastError);

        if (request.trackingId) {
          await NotificationDeliveryTrackingModel.create({
            notification_id: request.trackingId,
            status: DeliveryStatus.FAILED,
            channel: "email",
            provider: provider.name,
            error_message: lastError,
            metadata: { provider: provider.name, error: lastError },
          });
        }

        logger.warn(`Email failed via ${provider.name}, trying next`, {
          error: lastError,
        });
      }
    }

    return {
      success: false,
      error: `All providers failed. Last error: ${lastError}`,
      deliveryStatus: DeliveryStatus.FAILED,
    };
  }

  private async renderContent(
    request: EmailRequest,
  ): Promise<RenderedTemplate> {
    if (request.templateId) {
      return this.renderTemplate(
        request.templateId,
        request.templateData || {},
      );
    }
    return {
      subject: request.subject,
      html: request.htmlContent || "",
      text: request.textContent || "",
    };
  }

  async renderTemplate(
    templateId: string,
    data: Record<string, any>,
  ): Promise<RenderedTemplate> {
    try {
      const template = await NotificationTemplatesModel.getById(templateId);
      if (!template) throw new Error(`Template not found: ${templateId}`);

      let subject = template.subject || "";
      let html = template.html_content;
      let text = template.text_content;

      Object.entries(data).forEach(([key, value]) => {
        const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
        const str = String(value);
        subject = subject.replace(re, str);
        html = html.replace(re, str);
        text = text.replace(re, str);
      });

      return { subject, html, text };
    } catch (error) {
      logger.error("Failed to render email template", { error });
      return {
        subject: "Notification from MentorMinds",
        html: "<p>You have a new notification from MentorMinds.</p>",
        text: "You have a new notification from MentorMinds.",
      };
    }
  }

  private getNextHealthyProvider(): IEmailProvider | null {
    const start = this.currentProviderIndex;
    do {
      const provider = this.providers[this.currentProviderIndex];
      this.currentProviderIndex =
        (this.currentProviderIndex + 1) % this.providers.length;
      if (this.isProviderHealthy(provider)) return provider;
    } while (this.currentProviderIndex !== start);
    return null;
  }

  private isProviderHealthy(provider: IEmailProvider): boolean {
    if (provider.isHealthy) return true;
    if (provider.lastErrorTime) {
      const elapsed = Date.now() - provider.lastErrorTime.getTime();
      if (elapsed > this.circuitBreakerTimeout) {
        provider.isHealthy = true;
        provider.lastError = undefined;
        provider.lastErrorTime = undefined;
        logger.info(`Provider ${provider.name} circuit breaker reset`);
        return true;
      }
    }
    return false;
  }

  private handleProviderError(provider: IEmailProvider, error: string): void {
    provider.lastError = error;
    provider.lastErrorTime = new Date();
    provider.isHealthy = false;
    logger.warn(`Provider ${provider.name} marked unhealthy`, { error });
  }

  getProviderStatus(): {
    name: string;
    healthy: boolean;
    lastError?: string;
  }[] {
    return this.providers.map((p) => ({
      name: p.name,
      healthy: this.isProviderHealthy(p),
      lastError: p.lastError,
    }));
  }

  async sendTestEmail(to: string): Promise<EmailResult> {
    return this.sendEmail({
      to: [to],
      subject: "MentorMinds Email Service Test",
      htmlContent: `<div style="font-family:Arial,sans-serif"><h2 style="color:#4A90E2">Email Service Test</h2><p>If you received this, the email service is working correctly.</p><p style="color:#666;font-size:14px">Sent at: ${new Date().toISOString()}</p></div>`,
      textContent: `Email Service Test\n\nIf you received this, the email service is working correctly.\n\nSent at: ${new Date().toISOString()}`,
    });
  }
}

export const emailService = new EmailService();
export default emailService;
