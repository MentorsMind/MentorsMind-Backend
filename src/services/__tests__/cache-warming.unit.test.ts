import { CacheWarmingService, chunk } from "../cache-warming.service";
import { CacheOrchestrator, type L2Store } from "../cache-orchestrator.service";

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

function newService(): {
  warming: CacheWarmingService;
  cache: CacheOrchestrator;
  l2: FakeL2;
} {
  const l2 = new FakeL2();
  const cache = new CacheOrchestrator({ l2 });
  return { warming: new CacheWarmingService(cache, 2), cache, l2 };
}

describe("chunk", () => {
  it("splits into batches of the requested size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("rejects a size below one", () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe("CacheWarmingService", () => {
  it("loads every entry into the cache", async () => {
    const { warming, l2 } = newService();
    warming.register({
      name: "mentors",
      entries: () => [
        { key: "mentors:1", load: async () => "a" },
        { key: "mentors:2", load: async () => "b" },
        { key: "mentors:3", load: async () => "c" },
      ],
    });

    const result = await warming.run("mentors");

    expect(result.loaded).toBe(3);
    expect(result.failed).toBe(0);
    expect([...l2.store.keys()].sort()).toEqual([
      "mentors:1",
      "mentors:2",
      "mentors:3",
    ]);
  });

  it("respects the concurrency limit", async () => {
    const { warming } = newService();
    let inFlight = 0;
    let peak = 0;

    warming.register({
      name: "mentors",
      entries: () =>
        Array.from({ length: 6 }, (_, i) => ({
          key: `mentors:${i}`,
          load: async () => {
            peak = Math.max(peak, ++inFlight);
            await new Promise((r) => setImmediate(r));
            inFlight--;
            return i;
          },
        })),
    });

    await warming.run("mentors");

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("counts a failing entry without stopping the rest", async () => {
    const { warming, l2 } = newService();
    warming.register({
      name: "mentors",
      entries: () => [
        { key: "mentors:1", load: async () => "a" },
        {
          key: "mentors:2",
          load: async () => {
            throw new Error("db timeout");
          },
        },
        { key: "mentors:3", load: async () => "c" },
      ],
    });

    const result = await warming.run("mentors");

    expect(result.loaded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual(["mentors:2: db timeout"]);
    expect(l2.store.has("mentors:3")).toBe(true);
  });

  it("reports a failure in entries() rather than throwing", async () => {
    const { warming } = newService();
    warming.register({
      name: "broken",
      entries: () => {
        throw new Error("cannot list");
      },
    });

    const result = await warming.run("broken");

    expect(result.loaded).toBe(0);
    expect(result.errors[0]).toMatch(/entries\(\) failed: cannot list/);
  });

  it("reports an unknown warmer instead of throwing", async () => {
    const { warming } = newService();
    const result = await warming.run("missing");
    expect(result.errors[0]).toMatch(/no warmer registered/);
  });

  it("skips a disabled warmer", async () => {
    const { warming, l2 } = newService();
    warming.register({
      name: "off",
      enabled: false,
      entries: () => [{ key: "x", load: async () => "v" }],
    });

    expect((await warming.run("off")).loaded).toBe(0);
    expect(l2.store.size).toBe(0);
  });

  it("records warmed entries against their dependency tags", async () => {
    const { warming, cache } = newService();
    warming.register({
      name: "mentors",
      entries: () => [
        { key: "mentors:1", load: async () => "a", dependencies: ["mentor:1"] },
      ],
    });

    await warming.run("mentors");

    expect(await cache.invalidateTags(["mentor:1"])).toEqual(["mentors:1"]);
  });

  it("unregisters a warmer", async () => {
    const { warming } = newService();
    warming.register({ name: "mentors", entries: () => [] });
    warming.unregister("mentors");

    expect(warming.list()).toEqual([]);
  });
});
