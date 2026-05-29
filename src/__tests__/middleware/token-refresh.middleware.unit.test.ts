import crypto from "crypto";
import { handleTokenRefresh } from "../../middleware/token-refresh.middleware";
import { TokenService } from "../../services/token.service";
import { ResponseUtil } from "../../utils/response.utils";

jest.mock("../../services/token.service", () => ({
  TokenService: {
    rotateRefreshToken: jest.fn(),
  },
}));

jest.mock("../../utils/response.utils", () => ({
  ResponseUtil: {
    success: jest.fn(),
    unauthorized: jest.fn(),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    warn: jest.fn(),
  },
}));

describe("handleTokenRefresh middleware", () => {
  const mockRotateRefreshToken = TokenService.rotateRefreshToken as jest.Mock;
  const mockSuccess = ResponseUtil.success as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("computes request fingerprint and passes it to token rotation", async () => {
    mockRotateRefreshToken.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    });

    const req: any = {
      body: { refreshToken: "valid-refresh-token" },
      headers: {
        "user-agent": "Mozilla/5.0 test agent",
        "accept-language": "en-US,en;q=0.9",
      },
      ip: "203.0.113.10",
    };
    const res: any = {};
    const next = jest.fn();

    await handleTokenRefresh(req, res, next);

    const expectedFingerprint = crypto
      .createHash("sha256")
      .update("Mozilla/5.0 test agent|en-US,en;q=0.9|203.0.113.10")
      .digest("hex");

    expect(mockRotateRefreshToken).toHaveBeenCalledWith(
      "valid-refresh-token",
      expectedFingerprint,
    );
    expect(mockSuccess).toHaveBeenCalledWith(
      res,
      { accessToken: "new-access-token", refreshToken: "new-refresh-token" },
      "Token refreshed successfully",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("continues refresh flow when no fingerprint can be derived", async () => {
    mockRotateRefreshToken.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    });

    const req: any = {
      body: { refreshToken: "valid-refresh-token" },
      headers: {},
      ip: "",
      socket: { remoteAddress: "" },
    };
    const res: any = {};
    const next = jest.fn();

    await handleTokenRefresh(req, res, next);

    expect(mockRotateRefreshToken).toHaveBeenCalledWith(
      "valid-refresh-token",
      undefined,
    );
    expect(mockSuccess).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });
});
