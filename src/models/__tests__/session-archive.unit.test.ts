import pool from "../../config/database";
import { ErrorCode } from "../../errors/error-codes";
import { createError } from "../../middleware/errorHandler";
import { SessionModel } from "../session.model";
import { logger } from "../../utils/logger.utils";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
  db: { query: jest.fn(), connect: jest.fn() },
}));

jest.mock("../../middleware/errorHandler", () => ({
  createError: jest.fn(
    (
      code: string,
      statusCode: number,
      details: Record<string, unknown>,
    ) =>
      Object.assign(new Error(String(details.message)), {
        code,
        statusCode,
        details,
      }),
  ),
}));

describe("SessionModel.archiveOlderThanYears", () => {
  const queryMock = pool.query as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("logs and throws when the sessions archive table is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ exists: false }] });
    const errorSpy = jest
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);

    await expect(SessionModel.archiveOlderThanYears(2)).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      statusCode: 500,
      details: { message: "sessions_archive table missing — run migrations" },
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toContain(
      "SELECT FROM information_schema.tables",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      { message: "sessions_archive table missing — run migrations" },
      "SessionModel: archive table missing",
    );
    expect(createError).toHaveBeenCalledWith(
      ErrorCode.INTERNAL_SERVER_ERROR,
      500,
      { message: "sessions_archive table missing — run migrations" },
    );
  });

  it("archives old sessions when the archive table exists", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rowCount: 3 });

    await expect(SessionModel.archiveOlderThanYears(2)).resolves.toBe(3);

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1][0]).toContain("INSERT INTO sessions_archive");
    expect(queryMock.mock.calls[1][1]).toEqual([2]);
  });
});
