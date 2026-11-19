import { db } from "../../config/database";
import { ErrorCode } from "../../errors/error-codes";
import { CalendarSyncService, SyncStatus } from "../calendar-sync.service";

jest.mock("../../config/database", () => ({
  db: {
    query: jest.fn(),
  },
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockQuery = jest.mocked(db.query);

function queryResult(rows: { provider: string }[]) {
  return {
    rows,
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  };
}

describe("CalendarSyncService.startSync", () => {
  let service: CalendarSyncService;
  let performSync: jest.SpyInstance;

  const successfulSync: SyncStatus = {
    lastSync: new Date(),
    status: "success",
    eventsAdded: 0,
    eventsUpdated: 0,
    eventsDeleted: 0,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.clearAllTimers();
    service = new CalendarSyncService();
    mockQuery.mockResolvedValue(queryResult([{ provider: "google" }]));
    performSync = jest
      .spyOn(service, "performSync")
      .mockResolvedValue(successfulSync);
  });

  afterEach(() => {
    service.stopAllSyncs();
    jest.useRealTimers();
  });

  it("throws an AppError and does not start an interval when no provider is connected", async () => {
    mockQuery.mockResolvedValue(queryResult([]));

    await expect(service.startSync("user-1")).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
      statusCode: 400,
      isOperational: true,
      message: expect.stringMatching(/connect Google Calendar or Outlook/i),
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("provider IN ('google', 'microsoft')"),
      ["user-1"],
    );
    expect(performSync).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("starts syncing when a calendar provider is connected", async () => {
    await service.startSync("user-1", 15);

    expect(performSync).toHaveBeenCalledWith("user-1");
    expect(jest.getTimerCount()).toBe(1);
  });

  it("clears the interval when sync is stopped", async () => {
    await service.startSync("user-1", 15);

    await service.stopSync("user-1");

    expect(jest.getTimerCount()).toBe(0);
    expect((service as any).syncIntervals.size).toBe(0);
  });
});
