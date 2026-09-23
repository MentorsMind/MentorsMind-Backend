import https from "https";
import { EmailService } from "../email.service";
import {
  NotificationDeliveryTrackingModel,
  DeliveryStatus,
} from "../../models/notification-delivery-tracking.model";
import { NotificationTemplatesModel } from "../../models/notification-templates.model";

// ---------------------------------------------------------------------------
// Module-level mocks — all HTTP calls are intercepted here
// ---------------------------------------------------------------------------
jest.mock("https", () => ({
  request: jest.fn(),
}));

// Config is mutable so each test can override it
const configStore: Record<string, any> = {
  email: {
    provider: "sendgrid",
    smtp: { host: "", port: 587, secure: false, user: "", pass: "" },
    gmail: { user: "", pass: "" },
    sendgrid: { apiKey: "test-sg-key" },
    mailgun: { apiKey: "", domain: "", host: "" },
    fromEmail: "test@mentorminds.com",
    webhookSecret: "",
  },
};

jest.mock("../../config", () => ({
  __esModule: true,
  default: configStore,
}));

jest.mock("../../models/notification-templates.model", () => ({
  NotificationTemplatesModel: {
    getById: jest.fn(),
  },
}));

jest.mock("../../models/notification-delivery-tracking.model", () => ({
  NotificationDeliveryTrackingModel: {
    create: jest.fn(),
  },
  DeliveryStatus: {
    QUEUED: "queued",
    PROCESSING: "processing",
    SENT: "sent",
    DELIVERED: "delivered",
    FAILED: "failed",
  },
}));

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

// nodemailer is required lazily only by SmtpProvider
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers to control https.request
// ---------------------------------------------------------------------------

/**
 * Configure https.request to call its callback with the given response.
 */
function mockHttpsSuccess(
  statusCode: number,
  body: string,
  headers?: Record<string, string | string[]>,
) {
  const mockResponse = {
    statusCode,
    headers: headers || { "x-message-id": "sg-msg-001" },
    on: jest.fn((event: string, cb: Function) => {
      if (event === "data") cb(body);
      if (event === "end") cb();
    }),
  };

  const mockRequest = {
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };

  (https.request as jest.Mock).mockImplementation(
    (_opts: any, callback: Function) => {
      callback(mockResponse);
      return mockRequest;
    },
  );
  return { mockRequest, mockResponse };
}

/**
 * Configure https.request to reject with the given error.
 * The error is delivered asynchronously so the promise has time to set up.
 */
function mockHttpsError(message: string) {
  const mockRequest = {
    on: jest.fn((_event: string, cb: Function) => {
      setImmediate(() => cb(new Error(message)));
    }),
    write: jest.fn(),
    end: jest.fn(),
  };

  (https.request as jest.Mock).mockImplementation(() => mockRequest);
  return mockRequest;
}

/**
 * Configure https.request to deliver a non-2xx HTTP response (API error).
 */
function mockHttpsHttpError(statusCode: number, body: string) {
  const mockResponse = {
    statusCode,
    headers: {},
    on: jest.fn((event: string, cb: Function) => {
      if (event === "data") cb(body);
      if (event === "end") cb();
    }),
  };

  const mockRequest = {
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };

  (https.request as jest.Mock).mockImplementation(
    (_opts: any, callback: Function) => {
      callback(mockResponse);
      return mockRequest;
    },
  );
  return { mockRequest, mockResponse };
}

// ---------------------------------------------------------------------------
// Helpers to control nodemailer (SMTP fallback)
// ---------------------------------------------------------------------------

function mockNodemailerSuccess() {
  const nodemailer = require("nodemailer");
  (nodemailer.createTransport as jest.Mock).mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: "smtp-msg-001" }),
  });
}

function mockNodemailerError(message: string) {
  const nodemailer = require("nodemailer");
  (nodemailer.createTransport as jest.Mock).mockReturnValue({
    sendMail: jest.fn().mockRejectedValue(new Error(message)),
  });
}

// ---------------------------------------------------------------------------
// Clean up between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EmailService — provider fallback (#1091)", () => {
  describe("SendGrid as primary", () => {
    beforeEach(() => {
      configStore.email.provider = "sendgrid";
      configStore.email.sendgrid.apiKey = "test-sg-key";
      configStore.email.mailgun = { apiKey: "", domain: "", host: "" };
    });

    it("primary succeeds -> fallback not called, returns success", async () => {
      mockHttpsSuccess(202, "", { "x-message-id": "sg-12345" });

      const service = new EmailService();
      const result = await service.sendEmail({
        to: ["user@example.com"],
        subject: "Welcome",
        htmlContent: "<p>Hi</p>",
        textContent: "Hi",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("sg-12345");
      // Exactly one HTTP call -- no fallback
      expect(https.request).toHaveBeenCalledTimes(1);
      const callOpts = (https.request as jest.Mock).mock.calls[0][0];
      expect(callOpts.hostname).toContain("sendgrid");
    });

    it("primary HTTP error -> fallback (SMTP) called and succeeds", async () => {
      // SendGrid returns 401
      mockHttpsHttpError(401, '{"errors":[{"message":"unauthorized"}]}');
      // SMTP fallback succeeds
      mockNodemailerSuccess();

      const service = new EmailService();
      const result = await service.sendEmail({
        to: ["user@example.com"],
        subject: "Fallback test",
        htmlContent: "<p>test</p>",
        textContent: "test",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("smtp-msg-001");
      // SendGrid HTTP call attempted, SMTP uses nodemailer not https
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    it("primary throws -> fallback (SMTP) called and succeeds", async () => {
      mockHttpsError("Connection refused");
      mockNodemailerSuccess();

      const service = new EmailService();
      const result = await service.sendEmail({
        to: ["user@example.com"],
        subject: "Fallback test",
        htmlContent: "<p>test</p>",
        textContent: "test",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("smtp-msg-001");
    });

    it("both providers fail -> returns error with last error message", async () => {
      mockHttpsError("SendGrid down");
      mockNodemailerError("SMTP down");

      const service = new EmailService();
      const result = await service.sendEmail({
        to: ["user@example.com"],
        subject: "Both fail",
        htmlContent: "<p>test</p>",
        textContent: "test",
      });

      expect(result.success).toBe(false);
      expect(result.deliveryStatus).toBe(DeliveryStatus.FAILED);
      expect(result.error).toContain("SMTP down");
    });
  });

  describe("Mailgun as primary", () => {
    beforeEach(() => {
      configStore.email.provider = "mailgun";
      configStore.email.sendgrid.apiKey = "";
      configStore.email.mailgun = {
        apiKey: "test-mg-key",
        domain: "mg.example.com",
        host: "api.mailgun.net",
      };
    });

    it("primary succeeds -> returns Mailgun message ID", async () => {
      mockHttpsSuccess(200, JSON.stringify({ id: "<mg-001@mg.example.com>" }));

      const service = new EmailService();
      const result = await service.sendEmail({
        to: ["user@example.com"],
        subject: "Via Mailgun",
        htmlContent: "<p>Hi</p>",
        textContent: "Hi",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("<mg-001@mg.example.com>");
      expect(https.request).toHaveBeenCalledTimes(1);
      const callOpts = (https.request as jest.Mock).mock.calls[0][0];
      expect(callOpts.hostname).toContain("mailgun");
    });

    it("primary fails -> fallback (SMTP) called", async () => {
      mockHttpsError("Mailgun timeout");
      mockNodemailerSuccess();

      const service = new EmailService();
      const result = await service.sendEmail({
        to: ["user@example.com"],
        subject: "Mailgun fallback",
        htmlContent: "<p>test</p>",
        textContent: "test",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("smtp-msg-001");
    });

    it("both fail -> returns error summary", async () => {
      mockHttpsError("Mailgun 502");
      mockNodemailerError("SMTP quota exceeded");

      const service = new EmailService();
      const result = await service.sendEmail({
        to: ["user@example.com"],
        subject: "Fail",
        htmlContent: "<p>x</p>",
        textContent: "x",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("SMTP quota exceeded");
    });
  });

  describe("SMTP fallback always present", () => {
    it("uses SMTP as the final provider when primary is misconfigured", async () => {
      configStore.email.provider = "sendgrid";
      configStore.email.sendgrid.apiKey = "";

      const service = new EmailService();
      const status = service.getProviderStatus();

      // SendGrid skipped because apiKey is empty; only SMTP remains
      expect(status).toHaveLength(1);
      expect(status[0].name).toBe("SMTP");
    });
  });

  describe("provider selection via EMAIL_PROVIDER env var", () => {
    it("creates SendGrid provider when EMAIL_PROVIDER=sendgrid", () => {
      configStore.email.provider = "sendgrid";
      configStore.email.sendgrid.apiKey = "sg-key-123";

      const service = new EmailService();
      const status = service.getProviderStatus();

      expect(status).toHaveLength(2); // SendGrid + SMTP
      expect(status[0].name).toBe("SendGrid");
    });

    it("creates Mailgun provider when EMAIL_PROVIDER=mailgun", () => {
      configStore.email.provider = "mailgun";
      configStore.email.mailgun = {
        apiKey: "mg-key-456",
        domain: "mg.test.com",
        host: "api.mailgun.net",
      };

      const service = new EmailService();
      const status = service.getProviderStatus();

      expect(status).toHaveLength(2); // Mailgun + SMTP
      expect(status[0].name).toBe("Mailgun");
    });
  });
});