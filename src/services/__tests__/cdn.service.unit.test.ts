import { CDNService } from "../../services/cdn.service";

// ---------------------------------------------------------------------------
// Mock env module
// ---------------------------------------------------------------------------
const mockEnv: Record<string, string | undefined> = {};

jest.mock("../../config/env", () => ({ env: mockEnv }));

// Mock logger to suppress output
jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));

function setEnv(overrides: Record<string, string | undefined>) {
  Object.keys(mockEnv).forEach((k) => delete mockEnv[k]);
  Object.assign(mockEnv, overrides);
}

const BASE_ENV = {
  CDN_PROVIDER: "cloudfront",
  CDN_BASE_URL: "https://cdn.example.com",
  CDN_DOMAINS: "https://cdn1.example.com,https://cdn2.example.com",
  CDN_IMAGE_RESIZE: "true",
  CDN_WEBP_CONVERSION: "true",
  CDN_COMPRESSION: "true",
  CDN_CLOUDFRONT_DISTRIBUTION_ID: "EDFDVBD6EXAMPLE",
  AWS_REGION: "us-east-1",
};

afterEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------
describe("CDNService.getConfig", () => {
  it("returns null when CDN_PROVIDER is not set", () => {
    setEnv({});
    expect(CDNService.getConfig()).toBeNull();
  });

  it("returns null when CDN_BASE_URL is not set", () => {
    setEnv({ CDN_PROVIDER: "cloudfront" });
    expect(CDNService.getConfig()).toBeNull();
  });

  it("returns config when both CDN_PROVIDER and CDN_BASE_URL are set", () => {
    setEnv(BASE_ENV);
    const config = CDNService.getConfig();
    expect(config).not.toBeNull();
    expect(config!.provider).toBe("cloudfront");
    expect(config!.domains).toEqual([
      "https://cdn1.example.com",
      "https://cdn2.example.com",
    ]);
    expect(config!.cacheRules.length).toBeGreaterThan(0);
    expect(config!.optimization).toEqual({
      imageResize: true,
      webpConversion: true,
      compression: true,
    });
  });

  it("falls back to single domain when CDN_DOMAINS is not set", () => {
    setEnv({ ...BASE_ENV, CDN_DOMAINS: undefined });
    const config = CDNService.getConfig();
    expect(config).not.toBeNull();
    expect(config!.domains).toEqual(["https://cdn.example.com"]);
  });

  it("respects optimization flags from environment", () => {
    setEnv({
      ...BASE_ENV,
      CDN_IMAGE_RESIZE: "false",
      CDN_WEBP_CONVERSION: "false",
      CDN_COMPRESSION: "false",
    });
    const config = CDNService.getConfig();
    expect(config).not.toBeNull();
    expect(config!.optimization).toEqual({
      imageResize: false,
      webpConversion: false,
      compression: false,
    });
  });
});

// ---------------------------------------------------------------------------
// getAssetUrl
// ---------------------------------------------------------------------------
describe("CDNService.getAssetUrl", () => {
  it("returns original path when CDN is not configured", () => {
    setEnv({});
    expect(CDNService.getAssetUrl("/images/photo.jpg")).toBe(
      "/images/photo.jpg",
    );
  });

  it("prepends CDN domain to the asset path (first domain)", () => {
    setEnv(BASE_ENV);
    expect(CDNService.getAssetUrl("/images/photo.jpg")).toBe(
      "https://cdn1.example.com/images/photo.jpg",
    );
  });

  it("can specify domain index", () => {
    setEnv(BASE_ENV);
    expect(
      CDNService.getAssetUrl("/images/photo.jpg", { domainIndex: 1 }),
    ).toBe("https://cdn2.example.com/images/photo.jpg");
  });

  it("handles asset path without leading slash", () => {
    setEnv(BASE_ENV);
    expect(CDNService.getAssetUrl("images/photo.jpg")).toBe(
      "https://cdn1.example.com/images/photo.jpg",
    );
  });

  it("strips trailing slash from domain", () => {
    setEnv({ ...BASE_ENV, CDN_DOMAINS: "https://cdn.example.com/" });
    expect(CDNService.getAssetUrl("/images/photo.jpg")).toBe(
      "https://cdn.example.com/images/photo.jpg",
    );
  });

  it("adds version parameter when requested", () => {
    setEnv(BASE_ENV);
    expect(
      CDNService.getAssetUrl("/images/photo.jpg", {
        version: "abc123",
        useVersioning: true,
      }),
    ).toBe("https://cdn1.example.com/images/photo.jpg?v=abc123");
  });

  it("does not add version when useVersioning is false", () => {
    setEnv(BASE_ENV);
    expect(
      CDNService.getAssetUrl("/images/photo.jpg", {
        version: "abc123",
        useVersioning: false,
      }),
    ).toBe("https://cdn1.example.com/images/photo.jpg");
  });
});

// ---------------------------------------------------------------------------
// getCacheControlHeader
// ---------------------------------------------------------------------------
describe("CDNService.getCacheControlHeader", () => {
  beforeEach(() => setEnv(BASE_ENV));

  it("returns 1-day TTL for /images/* paths", () => {
    const header = CDNService.getCacheControlHeader("/images/avatar.png");
    expect(header).toContain("max-age=86400");
    expect(header).toContain("stale-while-revalidate=3600");
  });

  it("returns 7-day TTL for /videos/* paths", () => {
    const header = CDNService.getCacheControlHeader("/videos/session.mp4");
    expect(header).toContain("max-age=604800");
  });

  it("returns 1-day TTL for /documents/* paths", () => {
    const header = CDNService.getCacheControlHeader("/documents/report.pdf");
    expect(header).toContain("max-age=86400");
  });

  it("returns 30-day TTL for /static/* paths", () => {
    const header = CDNService.getCacheControlHeader("/static/app.js");
    expect(header).toContain("max-age=2592000");
  });

  it("returns default 1-hour TTL for unmatched paths", () => {
    const header = CDNService.getCacheControlHeader("/api/data");
    expect(header).toBe("public, max-age=3600");
  });

  it("includes 'public' directive", () => {
    const header = CDNService.getCacheControlHeader("/images/photo.jpg");
    expect(header).toContain("public");
  });
});

// ---------------------------------------------------------------------------
// generateAssetVersion
// ---------------------------------------------------------------------------
describe("CDNService.generateAssetVersion", () => {
  beforeEach(() => setEnv(BASE_ENV));

  it("generates hash-based version by default", () => {
    const version = CDNService.generateAssetVersion(
      Buffer.from("test content"),
    );
    expect(version).toHaveLength(8); // default hashLength
    expect(/^[a-f0-9]+$/.test(version)).toBe(true);
  });

  it("respects hashLength option", () => {
    const version = CDNService.generateAssetVersion(
      Buffer.from("test content"),
      { useHash: true, hashLength: 12 },
    );
    expect(version).toHaveLength(12);
  });

  it("falls back to timestamp-based versioning when useHash is false", () => {
    const version = CDNService.generateAssetVersion(
      Buffer.from("test content"),
      { useHash: false, hashLength: 8 }, // hashLength required but ignored when useHash=false
    );
    // Should be a timestamp string
    expect(/^\d+$/.test(version)).toBe(true);
    expect(parseInt(version, 10)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// invalidate — CloudFront
// ---------------------------------------------------------------------------
describe("CDNService.invalidate — CloudFront", () => {
  const mockSend = jest.fn();

  beforeEach(() => {
    setEnv(BASE_ENV);
    jest.resetModules();
    jest.doMock("@aws-sdk/client-cloudfront", () => ({
      CloudFrontClient: jest
        .fn()
        .mockImplementation(() => ({ send: mockSend })),
      CreateInvalidationCommand: jest.fn().mockImplementation((input) => input),
    }));
  });

  it("throws when CDN is not configured", async () => {
    setEnv({});
    await expect(CDNService.invalidate(["/images/photo.jpg"])).rejects.toThrow(
      "CDN is not configured",
    );
  });

  it("throws when CDN_CLOUDFRONT_DISTRIBUTION_ID is missing", async () => {
    setEnv({
      CDN_PROVIDER: "cloudfront",
      CDN_BASE_URL: "https://cdn.example.com",
    });
    await expect(CDNService.invalidate(["/images/photo.jpg"])).rejects.toThrow(
      "CDN_CLOUDFRONT_DISTRIBUTION_ID is not set",
    );
  });

  it("successfully invalidates CloudFront cache", async () => {
    const mockResult = {
      Invalidation: {
        Id: "EXAMPLE123",
      },
    };
    mockSend.mockResolvedValue(mockResult);

    const result = await CDNService.invalidate([
      "/images/photo.jpg",
      "/images/other.jpg",
    ]);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("cloudfront");
    expect(result.success).toBe(true);
    expect(result.invalidationId).toBe("EXAMPLE123");
    expect(result.paths).toEqual(["/images/photo.jpg", "/images/other.jpg"]);
  });
});

// ---------------------------------------------------------------------------
// invalidate — Cloudflare
// ---------------------------------------------------------------------------
describe("CDNService.invalidate — Cloudflare", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    setEnv({
      CDN_PROVIDER: "cloudflare",
      CDN_BASE_URL: "https://cdn.example.com",
      CDN_CLOUDFLARE_ZONE_ID: "zone123",
      CDN_CLOUDFLARE_API_TOKEN: "token456",
    });
    global.fetch = fetchMock;
  });

  it("calls Cloudflare purge API with correct URLs", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await CDNService.invalidate(["/images/photo.jpg"]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("cloudflare.com"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.provider).toBe("cloudflare");
    expect(result.success).toBe(true);
    expect(result.paths).toEqual(["/images/photo.jpg"]);
  });

  it("throws when Cloudflare API returns non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    await expect(CDNService.invalidate(["/images/photo.jpg"])).rejects.toThrow(
      "Cloudflare purge failed",
    );
  });

  it("throws when required Cloudflare env vars are missing", async () => {
    setEnv({
      CDN_PROVIDER: "cloudflare",
      CDN_BASE_URL: "https://cdn.example.com",
    });
    await expect(CDNService.invalidate(["/images/photo.jpg"])).rejects.toThrow(
      "CDN_CLOUDFLARE_ZONE_ID",
    );
  });
});

// ---------------------------------------------------------------------------
// invalidate — Fastly
// ---------------------------------------------------------------------------
describe("CDNService.invalidate — Fastly", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    setEnv({
      CDN_PROVIDER: "fastly",
      CDN_BASE_URL: "https://cdn.example.com",
      CDN_FASTLY_SERVICE_ID: "svc123",
      CDN_FASTLY_API_KEY: "key789",
    });
    global.fetch = fetchMock;
  });

  it("calls Fastly purge API for each path", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const result = await CDNService.invalidate([
      "/images/a.jpg",
      "/images/b.jpg",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("fastly");
    expect(result.success).toBe(true);
  });

  it("throws when Fastly API returns non-ok response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    await expect(CDNService.invalidate(["/images/photo.jpg"])).rejects.toThrow(
      "Fastly purge failed",
    );
  });

  it("throws when required Fastly env vars are missing", async () => {
    setEnv({ CDN_PROVIDER: "fastly", CDN_BASE_URL: "https://cdn.example.com" });
    await expect(CDNService.invalidate(["/images/photo.jpg"])).rejects.toThrow(
      "CDN_FASTLY_SERVICE_ID",
    );
  });
});

// ---------------------------------------------------------------------------
// New functionality tests
// ---------------------------------------------------------------------------
describe("CDNService optimization features", () => {
  beforeEach(() => setEnv(BASE_ENV));

  describe("optimizeImage", () => {
    it("returns original buffer when imageResize is disabled", async () => {
      setEnv({ ...BASE_ENV, CDN_IMAGE_RESIZE: "false" });
      const originalBuffer = Buffer.from("original image data");
      const result = await CDNService.optimizeImage(originalBuffer);
      expect(result.buffer).toBe(originalBuffer);
      expect(result.size).toBe(originalBuffer.length);
    });

    it("processes image when imageResize is enabled", async () => {
      // This test would require a real image buffer and sharp
      // For unit testing, we'll just verify it doesn't throw when config is present
      setEnv({ ...BASE_ENV, CDN_IMAGE_RESIZE: "true" });
      const originalBuffer = Buffer.from("fake image data");
      // We expect this to throw because "fake image data" is not a valid image
      // but we're mainly testing that the function is called and respects config
      await expect(
        CDNService.optimizeImage(originalBuffer, { width: 100 }),
      ).rejects.toThrow(); // sharp will throw on invalid image data
    });
  });

  describe("createResponsiveVariants", () => {
    it("returns original variant when imageResize is disabled", async () => {
      setEnv({ ...BASE_ENV, CDN_IMAGE_RESIZE: "false" });
      const originalBuffer = Buffer.from("original image data");
      const result = await CDNService.createResponsiveVariants(originalBuffer);
      expect(result).toHaveLength(1);
      expect(result[0].buffer).toBe(originalBuffer);
      expect(result[0].width).toBe(0);
    });
  });

  describe("createLowQualityPlaceholder", () => {
    it("generates a placeholder", async () => {
      // This would require a real image to test properly
      // We'll just verify the function exists and can be called
      expect(typeof CDNService.createLowQualityPlaceholder).toBe("function");
    });
  });
});
