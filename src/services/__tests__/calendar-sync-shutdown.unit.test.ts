/**
 * Unit test for CalendarSyncService.stopAllSyncs() graceful shutdown (#1290)
 *
 * Verifies:
 *  1. stopAllSyncs() clears all intervals in syncIntervals
 *  2. syncIntervals map is empty after stopAllSyncs()
 *  3. Log entry emitted with correct count
 *  4. Idempotent — safe to call with no active syncs
 */

import { CalendarSyncService } from '../calendar-sync.service';

jest.mock("../../config/database", () => ({
  db: {
    query: jest.fn().mockResolvedValue({ rows: [{ provider: "google" }] }),
  },
}));

// Fake timers so setInterval/clearInterval are fully controllable
beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());
beforeEach(() => jest.clearAllTimers());

// Mock logger to avoid real I/O and to assert log output
jest.mock('../../utils/logger.utils', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

import { logger } from '../../utils/logger.utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSyncIntervals(service: CalendarSyncService): Map<string, NodeJS.Timeout> {
  return (service as any).syncIntervals;
}

async function startSyncsFor(service: CalendarSyncService, userIds: string[]) {
  jest
    .spyOn(service as any, 'performSync')
    .mockResolvedValue({
      lastSync: new Date(),
      status: 'success',
      eventsAdded: 0,
      eventsUpdated: 0,
      eventsDeleted: 0,
    });

  for (const userId of userIds) {
    await service.startSync(userId, 15);
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('CalendarSyncService.stopAllSyncs() — graceful shutdown', () => {
  it('clears all intervals in syncIntervals', async () => {
    const service = new CalendarSyncService();
    await startSyncsFor(service, ['user-1', 'user-2', 'user-3']);

    expect(getSyncIntervals(service).size).toBe(3);

    service.stopAllSyncs();

    expect(getSyncIntervals(service).size).toBe(0);
  });

  it('syncIntervals map is empty after stopAllSyncs()', async () => {
    const service = new CalendarSyncService();
    await startSyncsFor(service, ['alice', 'bob']);

    service.stopAllSyncs();

    expect(getSyncIntervals(service).size).toBe(0);
  });

  it('calls clearInterval for every registered interval', async () => {
    const service = new CalendarSyncService();
    await startSyncsFor(service, ['x', 'y']);

    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const callsBefore = clearIntervalSpy.mock.calls.length;

    service.stopAllSyncs();

    expect(clearIntervalSpy.mock.calls.length - callsBefore).toBe(2);
    clearIntervalSpy.mockRestore();
  });

  it('emits logger.info with correct count when syncs are stopped', async () => {
    const service = new CalendarSyncService();
    await startSyncsFor(service, ['u1', 'u2', 'u3']);

    (logger.info as jest.Mock).mockClear();
    service.stopAllSyncs();

    expect(logger.info).toHaveBeenCalledWith(
      { count: 3 },
      'Calendar sync intervals stopped',
    );
  });

  it('is idempotent — calling stopAllSyncs() with no active syncs does not throw', () => {
    const service = new CalendarSyncService();

    expect(() => service.stopAllSyncs()).not.toThrow();
    expect(getSyncIntervals(service).size).toBe(0);
  });

  it('emits count: 0 when no syncs were running', () => {
    const service = new CalendarSyncService();

    (logger.info as jest.Mock).mockClear();
    service.stopAllSyncs();

    expect(logger.info).toHaveBeenCalledWith(
      { count: 0 },
      'Calendar sync intervals stopped',
    );
  });

  it('leaves no open timers after stopAllSyncs()', async () => {
    const service = new CalendarSyncService();
    await startSyncsFor(service, ['t1', 't2']);

    jest.advanceTimersByTime(5 * 60 * 1000);
    service.stopAllSyncs();

    expect(jest.getTimerCount()).toBe(0);
  });
});
