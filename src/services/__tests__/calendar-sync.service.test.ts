/**
 * CalendarSyncService — stopAllSyncs() unit tests
 *
 * Verifies that:
 *  1. stopAllSyncs() clears every active sync interval registered in the
 *     CalendarSyncService instance.
 *  2. The syncIntervals map is empty after stopAllSyncs() returns.
 *  3. No intervals remain active after a graceful shutdown call.
 *  4. The standalone stopAllSyncs export delegates to the singleton.
 *  5. stopAllSyncs() is idempotent (safe to call when no syncs are running).
 */

import {
  CalendarSyncService,
  calendarSyncService,
  stopAllSyncs,
} from '../../services/calendar-sync.service';

jest.mock("../../config/database", () => ({
  db: {
    query: jest.fn().mockResolvedValue({ rows: [{ provider: "google" }] }),
  },
}));

// Use fake timers so setInterval/clearInterval are fully under our control.
beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllTimers();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Access private `syncIntervals` map via type cast for white-box testing. */
function getSyncIntervals(
  service: CalendarSyncService,
): Map<string, NodeJS.Timeout> {
  return (service as any).syncIntervals;
}

// =============================================================================
// 1. stopAllSyncs() clears all intervals
// =============================================================================

describe('CalendarSyncService.stopAllSyncs()', () => {
  it('clears all active sync intervals', async () => {
    const service = new CalendarSyncService();

    // Bypass performSync (which calls fetchProviderEvents) by spying on it.
    jest
      .spyOn(service as any, 'performSync')
      .mockResolvedValue({
        lastSync: new Date(),
        status: 'success',
        eventsAdded: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
      });

    // Start syncs for three users.
    await service.startSync('user-1', 15);
    await service.startSync('user-2', 30);
    await service.startSync('user-3', 60);

    const intervals = getSyncIntervals(service);
    expect(intervals.size).toBe(3);

    // Stop all syncs.
    service.stopAllSyncs();

    expect(intervals.size).toBe(0);
  });

  it('clears every interval via clearInterval', async () => {
    const service = new CalendarSyncService();
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    jest
      .spyOn(service as any, 'performSync')
      .mockResolvedValue({
        lastSync: new Date(),
        status: 'success',
        eventsAdded: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
      });

    await service.startSync('user-a', 5);
    await service.startSync('user-b', 10);

    const callsBefore = clearIntervalSpy.mock.calls.length;

    service.stopAllSyncs();

    // clearInterval should have been called once for each interval we started.
    const callsAfter = clearIntervalSpy.mock.calls.length;
    expect(callsAfter - callsBefore).toBe(2);

    clearIntervalSpy.mockRestore();
  });

  it('syncIntervals map is empty after stopAllSyncs()', async () => {
    const service = new CalendarSyncService();

    jest
      .spyOn(service as any, 'performSync')
      .mockResolvedValue({
        lastSync: new Date(),
        status: 'success',
        eventsAdded: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
      });

    await service.startSync('user-x');

    service.stopAllSyncs();

    expect(getSyncIntervals(service).size).toBe(0);
  });

  it('is idempotent — calling stopAllSyncs() when no syncs are running does not throw', () => {
    const service = new CalendarSyncService();

    expect(() => service.stopAllSyncs()).not.toThrow();
    expect(getSyncIntervals(service).size).toBe(0);
  });

  it('does not affect a newly started sync after stopAllSyncs()', async () => {
    const service = new CalendarSyncService();

    jest
      .spyOn(service as any, 'performSync')
      .mockResolvedValue({
        lastSync: new Date(),
        status: 'success',
        eventsAdded: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
      });

    await service.startSync('user-1');
    service.stopAllSyncs();

    // Start a fresh sync after stopping.
    await service.startSync('user-2');

    expect(getSyncIntervals(service).size).toBe(1);
    expect(getSyncIntervals(service).has('user-2')).toBe(true);

    // Cleanup
    service.stopAllSyncs();
  });
});

// =============================================================================
// 2. Standalone stopAllSyncs export delegates to the singleton
// =============================================================================

describe('stopAllSyncs — standalone export', () => {
  it('delegates to calendarSyncService.stopAllSyncs()', async () => {
    const spy = jest
      .spyOn(calendarSyncService, 'stopAllSyncs')
      .mockImplementation(() => {});

    stopAllSyncs();

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// =============================================================================
// 3. Graceful shutdown — all timers cleared
// =============================================================================

describe('graceful shutdown — no orphaned timers', () => {
  it('all timers are cleared and jest detects no open handles after stopAllSyncs()', async () => {
    const service = new CalendarSyncService();

    jest
      .spyOn(service as any, 'performSync')
      .mockResolvedValue({
        lastSync: new Date(),
        status: 'success',
        eventsAdded: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
      });

    await service.startSync('u1', 5);
    await service.startSync('u2', 10);
    await service.startSync('u3', 15);

    // Advance fake timers to trigger a couple of sync cycles.
    jest.advanceTimersByTime(1000 * 60 * 5);

    service.stopAllSyncs();

    // After stopAllSyncs there must be no pending timers.
    expect(jest.getTimerCount()).toBe(0);
  });
});
