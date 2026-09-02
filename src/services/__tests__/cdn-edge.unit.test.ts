import {
  DEFAULT_BREAKPOINTS,
  domainFor,
  loadCDNConfig,
  negotiateImageFormat,
  providerChain,
  type CDNConfiguration,
} from "../../config/cdn.config";
import {
  EdgeFunctionsService,
  EdgeFunctionTimeout,
  geoRoutingFunction,
  withTimeout,
  type EdgeRequestContext,
} from "../edge-functions.service";
import {
  ImageOptimizerService,
  ImageTooLargeError,
  buildSrcset,
  joinUrl,
  variantKey,
  widthsFor,
  type ImageProcessor,
} from "../image-optimizer.service";

function config(overrides: Partial<CDNConfiguration> = {}): CDNConfiguration {
  return {
    primary: "cloudfront",
    failovers: [],
    domains: { cloudfront: "https://cdn.example.com" },
    images: {
      preferredFormats: ["avif", "webp", "jpeg"],
      breakpoints: [320, 640, 960],
      quality: 80,
      generatePlaceholder: false,
      maxSourceBytes: 1_000,
    },
    edge: { enabled: true, timeoutMs: 50, regions: ["global"] },
    ...overrides,
  };
}

function ctx(overrides: Partial<EdgeRequestContext> = {}): EdgeRequestContext {
  return {
    path: "/api/v1/mentors",
    method: "GET",
    headers: {},
    query: {},
    ...overrides,
  };
}

describe("cdn.config", () => {
  it("falls back to defaults with no environment set", () => {
    const loaded = loadCDNConfig();
    expect(loaded.primary).toBe("cloudfront");
    expect(loaded.images.breakpoints).toEqual(DEFAULT_BREAKPOINTS);
    expect(loaded.edge.enabled).toBe(false);
  });

  it("picks the first accepted format in preference order", () => {
    const images = config().images;
    expect(negotiateImageFormat("image/avif,image/webp,*/*", images)).toBe(
      "avif",
    );
    expect(negotiateImageFormat("image/webp,image/jpeg", images)).toBe("webp");
  });

  it("falls back rather than guessing when Accept is absent or wildcard-only", () => {
    const images = config().images;
    expect(negotiateImageFormat(undefined, images)).toBe("jpeg");
    expect(negotiateImageFormat("*/*", images)).toBe("jpeg");
  });

  it("strips a trailing slash from a domain", () => {
    expect(
      domainFor(
        "cloudfront",
        config({ domains: { cloudfront: "https://x.dev/" } }),
      ),
    ).toBe("https://x.dev");
    expect(domainFor("fastly", config())).toBeNull();
  });

  it("builds a provider chain of configured providers only", () => {
    const cfg = config({
      failovers: ["cloudflare", "fastly"],
      domains: { cloudfront: "https://a.dev", cloudflare: "https://b.dev" },
    });
    expect(providerChain(cfg)).toEqual(["cloudfront", "cloudflare"]);
  });
});

describe("EdgeFunctionsService", () => {
  it("runs matching functions in priority order", async () => {
    const service = new EdgeFunctionsService(config());
    service.register({
      name: "second",
      trigger: "viewer-request",
      routes: [],
      priority: 20,
      handler: () => ({ headers: { b: "2" } }),
    });
    service.register({
      name: "first",
      trigger: "viewer-request",
      routes: [],
      priority: 10,
      handler: () => ({ headers: { a: "1" } }),
    });

    const run = await service.execute("viewer-request", ctx());

    expect(run.applied).toEqual(["first", "second"]);
    expect(run.result.headers).toEqual({ a: "1", b: "2" });
  });

  it("only runs functions whose route prefix matches", async () => {
    const service = new EdgeFunctionsService(config());
    service.register({
      name: "media-only",
      trigger: "viewer-request",
      routes: ["/assets"],
      handler: () => ({ headers: { x: "1" } }),
    });

    expect((await service.execute("viewer-request", ctx())).applied).toEqual(
      [],
    );
    expect(
      (await service.execute("viewer-request", ctx({ path: "/assets/a.png" })))
        .applied,
    ).toEqual(["media-only"]);
  });

  it("stops the chain at a redirect", async () => {
    const service = new EdgeFunctionsService(config());
    service.register({
      name: "redirector",
      trigger: "viewer-request",
      routes: [],
      priority: 1,
      handler: () => ({ redirect: { status: 308 as const, location: "/new" } }),
    });
    service.register({
      name: "never",
      trigger: "viewer-request",
      routes: [],
      priority: 2,
      handler: () => ({ headers: { x: "1" } }),
    });

    const run = await service.execute("viewer-request", ctx());

    expect(run.applied).toEqual(["redirector"]);
    expect(run.result.redirect?.location).toBe("/new");
  });

  it("skips a throwing function and keeps going", async () => {
    const service = new EdgeFunctionsService(config());
    service.register({
      name: "broken",
      trigger: "viewer-request",
      routes: [],
      priority: 1,
      handler: () => {
        throw new Error("bad rule");
      },
    });
    service.register({
      name: "healthy",
      trigger: "viewer-request",
      routes: [],
      priority: 2,
      handler: () => ({ headers: { x: "1" } }),
    });

    const run = await service.execute("viewer-request", ctx());

    expect(run.failed).toEqual([{ name: "broken", reason: "bad rule" }]);
    expect(run.applied).toEqual(["healthy"]);
  });

  it("abandons a function that overruns its budget", async () => {
    const service = new EdgeFunctionsService(
      config({ edge: { enabled: true, timeoutMs: 10, regions: [] } }),
    );
    service.register({
      name: "slow",
      trigger: "viewer-request",
      routes: [],
      handler: () =>
        new Promise((resolve) => setTimeout(() => resolve({}), 200)),
    });

    const run = await service.execute("viewer-request", ctx());

    expect(run.applied).toEqual([]);
    expect(run.failed[0].reason).toMatch(/exceeded 10ms/);
  });

  it("runs nothing when the edge is disabled", async () => {
    const service = new EdgeFunctionsService(
      config({ edge: { enabled: false, timeoutMs: 50, regions: [] } }),
    );
    service.register({
      name: "any",
      trigger: "viewer-request",
      routes: [],
      handler: () => ({ headers: { x: "1" } }),
    });

    expect((await service.execute("viewer-request", ctx())).applied).toEqual(
      [],
    );
  });

  it("maps a country to a region and defaults the rest", async () => {
    const service = new EdgeFunctionsService(config());
    service.register(
      geoRoutingFunction({ NG: "af-west", US: "us-east" }, "eu-west"),
    );

    const mapped = await service.execute(
      "viewer-request",
      ctx({ country: "ng" }),
    );
    const unmapped = await service.execute(
      "viewer-request",
      ctx({ country: "JP" }),
    );

    expect(mapped.result.headers?.["x-mm-region"]).toBe("af-west");
    expect(unmapped.result.headers?.["x-mm-region"]).toBe("eu-west");
  });

  it("describes registered functions for deployment", () => {
    const service = new EdgeFunctionsService(config());
    service.register(geoRoutingFunction({}, "eu-west"));

    const manifest = service.manifest();

    expect(manifest.provider).toBe("cloudfront");
    expect(manifest.functions).toEqual([
      {
        name: "geo-routing",
        trigger: "viewer-request",
        routes: [],
        priority: 10,
      },
    ]);
  });
});

describe("withTimeout", () => {
  it("resolves a fast promise untouched", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "fn")).resolves.toBe(
      "ok",
    );
  });

  it("rejects with EdgeFunctionTimeout once the budget elapses", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slow, 10, "fn")).rejects.toBeInstanceOf(
      EdgeFunctionTimeout,
    );
  });
});

describe("image-optimizer helpers", () => {
  it("drops breakpoints wider than the source and keeps the source width", () => {
    expect(widthsFor(800, [320, 640, 960, 1920])).toEqual([320, 640, 800]);
  });

  it("returns only the source width when it is the narrowest", () => {
    expect(widthsFor(200, [320, 640])).toEqual([200]);
  });

  it("derives a stable, content-addressed key", () => {
    const a = variantKey("abcdef1234567890", 640, "webp", 80);
    expect(a).toBe(variantKey("abcdef1234567890", 640, "webp", 80));
    expect(a).not.toBe(variantKey("abcdef1234567890", 640, "webp", 60));
    expect(a.endsWith(".webp")).toBe(true);
  });

  it("joins a base URL and key without doubling slashes", () => {
    expect(joinUrl("https://cdn.dev/", "/img/a.webp")).toBe(
      "https://cdn.dev/img/a.webp",
    );
  });

  it("builds a srcset with width descriptors", () => {
    const variants = [
      { width: 320, format: "webp" as const, key: "img/a.webp", bytes: 10 },
      { width: 640, format: "webp" as const, key: "img/b.webp", bytes: 20 },
    ];
    expect(buildSrcset(variants, "https://cdn.dev")).toBe(
      "https://cdn.dev/img/a.webp 320w, https://cdn.dev/img/b.webp 640w",
    );
  });
});

describe("ImageOptimizerService", () => {
  const processor: ImageProcessor = {
    async process(_buffer, options, format) {
      const width = options.width ?? 100;
      return {
        buffer: Buffer.alloc(0),
        format: format as any,
        width,
        height: width,
        size: width,
      };
    },
    async lqip() {
      return "data:image/webp;base64,AAAA";
    },
    async metadata() {
      return { width: 800, height: 600 };
    },
  };

  it("produces one variant per usable width with a matching srcset", async () => {
    const service = new ImageOptimizerService(config(), processor);

    const result = await service.optimize(
      Buffer.alloc(500),
      "https://cdn.dev",
      "image/webp",
    );

    expect(result.format).toBe("webp");
    expect(result.variants.map((v) => v.width)).toEqual([320, 640, 800]);
    expect(result.srcset.split(", ")).toHaveLength(3);
    expect(result.savedBytes).toBe(500 - 320);
  });

  it("refuses a source over the configured limit", async () => {
    const service = new ImageOptimizerService(config(), processor);
    await expect(
      service.optimize(Buffer.alloc(2_000), "https://cdn.dev"),
    ).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("keeps the remaining variants when one rendition fails", async () => {
    let calls = 0;
    const flaky: ImageProcessor = {
      ...processor,
      async process(buffer, options, format, quality) {
        if (++calls === 2) throw new Error("encoder failed");
        return processor.process(buffer, options, format, quality);
      },
    };
    const service = new ImageOptimizerService(config(), flaky);

    const result = await service.optimize(
      Buffer.alloc(500),
      "https://cdn.dev",
      "image/webp",
    );

    expect(result.variants.map((v) => v.width)).toEqual([320, 800]);
  });

  it("emits a placeholder only when enabled", async () => {
    const withPlaceholder = config();
    withPlaceholder.images.generatePlaceholder = true;
    const service = new ImageOptimizerService(withPlaceholder, processor);

    const result = await service.optimize(Buffer.alloc(500), "https://cdn.dev");
    expect(result.placeholder).toMatch(/^data:image\/webp/);

    const without = new ImageOptimizerService(config(), processor);
    expect(
      (await without.optimize(Buffer.alloc(500), "https://cdn.dev"))
        .placeholder,
    ).toBeUndefined();
  });
});
