import { horizonStreamService } from "../services/horizonStream.service";

export const stellarMonitorJob = {
  async start(): Promise<void> {
    await horizonStreamService.start();
  },

  stop(): void {
    horizonStreamService.stop();
  },
};
