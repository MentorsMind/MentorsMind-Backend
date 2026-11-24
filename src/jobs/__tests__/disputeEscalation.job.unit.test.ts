jest.mock("cron", () => ({
  CronJob: jest.fn().mockImplementation((_schedule: string, _cb: any) => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

jest.mock("../../services/disputes.service", () => ({
  DisputeService: {
    escalateOldDisputes: jest.fn(),
  },
}));

import { DisputeService } from "../../services/disputes.service";
import {
  runDisputeEscalationJob,
  DisputeEscalationJob,
  disputeEscalationJob,
} from "../disputeEscalation.job";

const escalateOldDisputesMock = DisputeService.escalateOldDisputes as jest.Mock;

describe("disputeEscalationJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    disputeEscalationJob.stop();
  });

  describe("runDisputeEscalationJob", () => {
    it("runs escalation job successfully and returns escalatedCount", async () => {
      escalateOldDisputesMock.mockResolvedValueOnce(3);

      const result = await runDisputeEscalationJob();

      expect(escalateOldDisputesMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ escalatedCount: 3 });
    });

    it("throws and logs error if escalateOldDisputes throws", async () => {
      escalateOldDisputesMock.mockRejectedValueOnce(new Error("Database error"));

      await expect(runDisputeEscalationJob()).rejects.toThrow("Database error");
      expect(escalateOldDisputesMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("DisputeEscalationJob lifecycle", () => {
    it("can be initialized and stopped cleanly", () => {
      const job = new DisputeEscalationJob();
      expect(() => job.initialize()).not.toThrow();
      expect(() => job.initialize()).not.toThrow(); // second call warns but does not crash
      expect(() => job.stop()).not.toThrow();
    });
  });
});
