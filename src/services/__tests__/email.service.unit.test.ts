import { EmailService, IEmailProvider } from "../email.service";
import {
  emailDeliveryFailuresTotal,
  emailDeliverySuccessTotal,
} from "../../config/metrics";

describe("EmailService delivery metrics", () => {
  function request() {
    return { to: ["user@example.com"], subject: "Test" };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("increments the failure counter when a provider send throws", async () => {
    const provider: IEmailProvider = {
      name: "SendGrid",
      isHealthy: true,
      send: jest.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const service = new EmailService();
    (service as any).providers = [provider];

    const result = await service.sendEmail(request());
    const metric = await emailDeliveryFailuresTotal.get();

    expect(result.success).toBe(false);
    expect(metric.values.some((value) => value.labels.provider === "sendgrid" && value.value >= 1)).toBe(true);
  });

  it("increments the success counter after a provider send succeeds", async () => {
    const provider: IEmailProvider = {
      name: "SMTP",
      isHealthy: true,
      send: jest.fn().mockResolvedValue({ messageId: "message-1" }),
    };
    const service = new EmailService();
    (service as any).providers = [provider];

    const result = await service.sendEmail(request());
    const metric = await emailDeliverySuccessTotal.get();

    expect(result.success).toBe(true);
    expect(metric.values.some((value) => value.labels.provider === "smtp" && value.value >= 1)).toBe(true);
  });
});
