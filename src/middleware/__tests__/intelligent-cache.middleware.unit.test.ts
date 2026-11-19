// `cache.middleware` pulls in the validated env config, which exits the process
// when secrets are absent. Only `signUserId` is needed here, so it is stubbed.
jest.mock("../cache.middleware", () => ({
  signUserId: (userId: string) => `signed-${userId}`,
}));

import type { Request, Response } from "express";
import {
  buildCacheKey,
  intelligentCache,
  invalidateDependencies,
  type IntelligentCacheOptions,
} from "../intelligent-cache.middleware";
import {
  CacheOrchestrator,
  type L2Store,
} from "../../services/cache-orchestrator.service";

class FakeL2 implements L2Store {
  store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    originalUrl: "/api/v1/mentors",
    headers: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & {
  _headers: Record<string, unknown>;
  _body?: unknown;
} {
  const headers: Record<string, unknown> = {};
  const res = {
    statusCode: 200,
    _headers: headers,
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
    getHeader: (name: string) => headers[name],
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      (res as any)._body = body;
      return this;
    },
  };
  return res as unknown as Response & {
    _headers: Record<string, unknown>;
    _body?: unknown;
  };
}

function options(
  extra: Partial<IntelligentCacheOptions> = {},
): IntelligentCacheOptions {
  return { namespace: "mentors", ttl: 60, ...extra };
}

describe("buildCacheKey", () => {
  it("is stable for the same request and namespaced", () => {
    const key = buildCacheKey(mockReq(), options());
    expect(key).toBe(buildCacheKey(mockReq(), options()));
    expect(key.startsWith("mentors:http:")).toBe(true);
  });

  it("separates different URLs", () => {
    expect(buildCacheKey(mockReq({ originalUrl: "/a" }), options())).not.toBe(
      buildCacheKey(mockReq({ originalUrl: "/b" }), options()),
    );
  });

  it("folds vary headers into the key", () => {
    const en = mockReq({ headers: { "accept-language": "en" } });
    const fr = mockReq({ headers: { "accept-language": "fr" } });
    const opts = options({ vary: ["accept-language"] });

    expect(buildCacheKey(en, opts)).not.toBe(buildCacheKey(fr, opts));
  });

  it("scopes an authenticated key to the caller without leaking the id", () => {
    const opts = options({ cacheAuthenticated: true });
    const a = buildCacheKey(mockReq({ user: { id: "user-a" } } as any), opts);
    const b = buildCacheKey(mockReq({ user: { id: "user-b" } } as any), opts);

    expect(a).not.toBe(b);
    expect(a).not.toContain("user-a");
  });
});

describe("intelligentCache", () => {
  let cache: CacheOrchestrator;

  beforeEach(() => {
    cache = new CacheOrchestrator({ l2: new FakeL2() });
  });

  it("passes a miss through and caches the response", async () => {
    const middleware = intelligentCache(options({ orchestrator: cache }));
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res._headers["X-Cache"]).toBe("MISS");

    res.json({ mentors: [] });

    const res2 = mockRes();
    const next2 = jest.fn();
    await middleware(mockReq(), res2, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2._headers["X-Cache"]).toBe("HIT");
    expect(res2._headers["X-Cache-Tier"]).toBe("l1");
    expect(res2._body).toEqual({ mentors: [] });
  });

  it("does not cache an error response", async () => {
    const middleware = intelligentCache(options({ orchestrator: cache }));
    const res = mockRes();
    await middleware(mockReq(), res, jest.fn());
    res.status(500).json({ error: "boom" });

    const res2 = mockRes();
    const next2 = jest.fn();
    await middleware(mockReq(), res2, next2);

    expect(next2).toHaveBeenCalled();
  });

  it("skips non-GET requests", async () => {
    const middleware = intelligentCache(options({ orchestrator: cache }));
    const next = jest.fn();
    await middleware(mockReq({ method: "POST" }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("skips authenticated requests unless opted in", async () => {
    const middleware = intelligentCache(options({ orchestrator: cache }));
    const res = mockRes();
    const next = jest.fn();

    await middleware(mockReq({ user: { id: "u1" } } as any), res, next);

    expect(next).toHaveBeenCalled();
    expect(res._headers["X-Cache"]).toBeUndefined();
  });

  it("honours a per-request skip predicate", async () => {
    const middleware = intelligentCache(
      options({
        orchestrator: cache,
        skip: (r) => r.originalUrl.includes("nocache"),
      }),
    );
    const next = jest.fn();
    await middleware(
      mockReq({ originalUrl: "/mentors?nocache=1" }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it("drops a cached response when its dependency is invalidated", async () => {
    const middleware = intelligentCache(
      options({
        orchestrator: cache,
        dependencies: (r) => [`mentor:${r.params.id}`],
      }),
    );
    const req = mockReq({
      originalUrl: "/api/v1/mentors/42",
      params: { id: "42" },
    } as any);

    const res = mockRes();
    await middleware(req, res, jest.fn());
    res.json({ id: "42" });

    const dropped = await invalidateDependencies(["mentor:42"], cache);
    expect(dropped).toHaveLength(1);

    const res2 = mockRes();
    const next2 = jest.fn();
    await middleware(req, res2, next2);
    expect(next2).toHaveBeenCalled();
  });

  it("replays content-type on a hit", async () => {
    const middleware = intelligentCache(options({ orchestrator: cache }));
    const res = mockRes();
    await middleware(mockReq(), res, jest.fn());
    res.setHeader("content-type", "application/json");
    res.json({ ok: true });

    const res2 = mockRes();
    await middleware(mockReq(), res2, jest.fn());

    expect(res2._headers["content-type"]).toBe("application/json");
  });
});
