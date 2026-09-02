import {
  CacheOrchestrator,
  DependencyGraph,
  L1Store,
  namespaceOf,
  type InvalidationMessage,
  type L2Store,
  type L3Purger,
  type OrchestratorEvent,
} from "../cache-orchestrator.service";

class FakeL2 implements L2Store {
  store = new Map<string, unknown>();
  getCalls = 0;

  async get<T>(key: string): Promise<T | null> {
    this.getCalls++;
    return (this.store.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class FakePurger implements L3Purger {
  purged: string[] = [];
  async purge(keys: string[]): Promise<void> {
    this.purged.push(...keys);
  }
}

describe("L1Store", () => {
  it("reports an entry past its TTL as expired without dropping it", () => {
    const store = new L1Store();
    store.set("a", 1, 60, 1_000);

    expect(store.get("a", 1_000)).toEqual({ value: 1, expired: false });
    expect(store.get("a", 70_000)).toEqual({ value: 1, expired: true });
  });

  it("evicts the least recently used entry once full", () => {
    const store = new L1Store(2);
    store.set("a", 1, 60);
    store.set("b", 2, 60);
    store.get("a"); // 'a' is now more recent than 'b'
    store.set("c", 3, 60);

    expect(store.size).toBe(2);
    expect(store.get("b")).toBeNull();
    expect(store.get("a")?.value).toBe(1);
    expect(store.evictionCount).toBe(1);
  });

  it("prunes only expired entries", () => {
    const store = new L1Store();
    store.set("fresh", 1, 60, 1_000);
    store.set("stale", 2, 1, 1_000);

    expect(store.prune(5_000)).toBe(1);
    expect(store.get("fresh", 5_000)?.value).toBe(1);
  });
});

describe("DependencyGraph", () => {
  it("resolves keys reachable through a chain of tags", () => {
    const graph = new DependencyGraph();
    graph.addKey("page:mentor-list", ["mentors"]);
    graph.addKey("page:mentor-42", ["mentor:42"]);
    graph.addTagEdge("mentors", "mentor:42");

    expect(graph.resolve(["mentor:42"]).sort()).toEqual([
      "page:mentor-42",
      "page:mentor-list",
    ]);
  });

  it("terminates on a cycle", () => {
    const graph = new DependencyGraph();
    graph.addKey("k", ["a"]);
    graph.addTagEdge("a", "b");
    graph.addTagEdge("b", "a");

    expect(graph.resolve(["a"])).toEqual(["k"]);
  });

  it("forgets a key it no longer holds", () => {
    const graph = new DependencyGraph();
    graph.addKey("k", ["a"]);
    graph.removeKey("k");

    expect(graph.resolve(["a"])).toEqual([]);
  });
});

describe("CacheOrchestrator", () => {
  it("serves L1 before touching L2", async () => {
    const l2 = new FakeL2();
    const cache = new CacheOrchestrator({ l2 });
    const loader = jest.fn().mockResolvedValue("value");

    await cache.get("mentors:1", loader);
    const second = await cache.get("mentors:1", loader);

    expect(second).toEqual({ value: "value", tier: "l1", stale: false });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(l2.getCalls).toBe(1); // only the first, cold read
  });

  it("promotes an L2 hit into L1", async () => {
    const l2 = new FakeL2();
    l2.store.set("mentors:1", "from-redis");
    const cache = new CacheOrchestrator({ l2 });
    const loader = jest.fn();

    const first = await cache.get("mentors:1", loader);
    const second = await cache.get("mentors:1", loader);

    expect(first.tier).toBe("l2");
    expect(second.tier).toBe("l1");
    expect(loader).not.toHaveBeenCalled();
  });

  it("collapses concurrent misses into a single load", async () => {
    const cache = new CacheOrchestrator({ l2: new FakeL2() });
    let resolve!: (value: string) => void;
    const loader = jest.fn(() => new Promise<string>((r) => (resolve = r)));

    const reads = Promise.all([
      cache.get("mentors:1", loader),
      cache.get("mentors:1", loader),
      cache.get("mentors:1", loader),
    ]);
    // The reads await the L2 lookup before reaching the loader, so let the
    // microtask queue drain before resolving it.
    await new Promise((r) => setImmediate(r));
    resolve("value");
    const results = await reads;

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.value)).toEqual(["value", "value", "value"]);
  });

  it("serves a stale entry and refreshes behind the request", async () => {
    const l1 = new L1Store();
    const cache = new CacheOrchestrator({ l1, l2: new FakeL2() });
    l1.set("mentors:1", "old", -1); // already expired
    const loader = jest.fn().mockResolvedValue("new");

    const stale = await cache.get("mentors:1", loader, {
      staleWhileRevalidate: true,
    });
    expect(stale).toEqual({ value: "old", tier: "l1", stale: true });

    await new Promise((r) => setImmediate(r));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(l1.get("mentors:1")?.value).toBe("new");
  });

  it("invalidates every tier and every dependent key", async () => {
    const l2 = new FakeL2();
    const l3 = new FakePurger();
    const cache = new CacheOrchestrator({ l2, l3 });

    await cache.set("page:list", "a", { dependencies: ["mentors"] });
    await cache.set("page:42", "b", { dependencies: ["mentor:42"] });
    cache.dependsOn("mentors", "mentor:42");

    const dropped = await cache.invalidateTags(["mentor:42"]);

    expect(dropped.sort()).toEqual(["page:42", "page:list"]);
    expect(l2.store.size).toBe(0);
    expect(l3.purged.sort()).toEqual(["page:42", "page:list"]);
    expect(cache.localSize).toBe(0);
  });

  it("broadcasts invalidations and drops L1 on a sibling message", async () => {
    const published: InvalidationMessage[] = [];
    let handler: (m: InvalidationMessage) => void = () => {};
    const broadcaster = {
      publish: async (m: InvalidationMessage) => {
        published.push(m);
      },
      subscribe: async (h: (m: InvalidationMessage) => void) => {
        handler = h;
      },
    };

    const cache = new CacheOrchestrator({
      l2: new FakeL2(),
      broadcaster,
      instanceId: "instance-a",
    });
    await cache.connect();
    await cache.set("mentors:1", "value");

    await cache.invalidateKeys(["mentors:1"]);
    expect(published[0]).toEqual({
      origin: "instance-a",
      keys: ["mentors:1"],
      tags: [],
    });

    await cache.set("mentors:2", "value");
    handler({ origin: "instance-b", keys: ["mentors:2"], tags: [] });
    expect(cache.localSize).toBe(0);
  });

  it("ignores its own broadcast", async () => {
    let handler: (m: InvalidationMessage) => void = () => {};
    const cache = new CacheOrchestrator({
      l2: new FakeL2(),
      broadcaster: {
        publish: async () => {},
        subscribe: async (h) => {
          handler = h;
        },
      },
      instanceId: "instance-a",
    });
    await cache.connect();
    await cache.set("mentors:1", "value");

    handler({ origin: "instance-a", keys: ["mentors:1"], tags: [] });

    expect(cache.localSize).toBe(1);
  });

  it("reports the tier of every read to observers", async () => {
    const events: OrchestratorEvent[] = [];
    const cache = new CacheOrchestrator({ l2: new FakeL2() });
    cache.observe((e) => events.push(e));

    await cache.get("mentors:1", async () => "value");
    await cache.get("mentors:1", async () => "value");

    expect(events.map((e) => `${e.type}:${e.tier}`)).toEqual([
      "set:null",
      "miss:loader",
      "hit:l1",
    ]);
    expect(events[0].namespace).toBe("mentors");
  });

  it("does not let a throwing observer break a read", async () => {
    const cache = new CacheOrchestrator({ l2: new FakeL2() });
    cache.observe(() => {
      throw new Error("observer blew up");
    });

    await expect(cache.get("mentors:1", async () => "value")).resolves.toEqual({
      value: "value",
      tier: "loader",
      stale: false,
    });
  });

  it("does not fail an invalidation when the broadcast fails", async () => {
    const cache = new CacheOrchestrator({
      l2: new FakeL2(),
      broadcaster: {
        publish: async () => {
          throw new Error("redis down");
        },
        subscribe: async () => {},
      },
    });
    await cache.set("mentors:1", "value");

    await expect(cache.invalidateKeys(["mentors:1"])).resolves.toBeUndefined();
    expect(cache.localSize).toBe(0);
  });
});

describe("namespaceOf", () => {
  it("takes the first colon-delimited segment", () => {
    expect(namespaceOf("mentors:http:abc")).toBe("mentors");
    expect(namespaceOf("flat")).toBe("flat");
  });
});
