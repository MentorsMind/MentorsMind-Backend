/**
 * Cache warming, analytics and dependency-graph tests (issue #864).
 */

import { CacheWarmingService } from '../cache-warming.service';
import {
  CacheAnalyticsService,
  namespaceOf,
} from '../cache-analytics.service';
import { CacheDependencyGraph } from '../performance/cache-dependency-graph';
import type { CacheEvent } from '../cache-orchestrator.service';

// ─── Warming ──────────────────────────────────────────────────────────────────

describe('CacheWarmingService', () => {
  let service: CacheWarmingService;

  beforeEach(() => {
    service = new CacheWarmingService();
  });

  it('runs every registered warmer', async () => {
    const a = jest.fn().mockResolvedValue(undefined);
    const b = jest.fn().mockResolvedValue(undefined);
    service.register({ name: 'a', priority: 1, warm: a });
    service.register({ name: 'b', priority: 1, warm: b });

    const report = await service.warmAll();

    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(report.succeeded).toBe(2);
  });

  it('orders warmers by descending priority', async () => {
    const order: string[] = [];
    service.register({
      name: 'low',
      priority: 1,
      warm: async () => { order.push('low'); },
    });
    service.register({
      name: 'high',
      priority: 100,
      warm: async () => { order.push('high'); },
    });

    // Serial, so start order is observable.
    await service.warmAll({ concurrency: 1 });
    expect(order).toEqual(['high', 'low']);
  });

  it('keeps going when one warmer fails', async () => {
    service.register({
      name: 'bad',
      priority: 5,
      warm: async () => { throw new Error('boom'); },
    });
    const good = jest.fn().mockResolvedValue(undefined);
    service.register({ name: 'good', priority: 1, warm: good });

    const report = await service.warmAll({ concurrency: 1 });

    // Warming is best-effort — one cold segment must not abort startup.
    expect(good).toHaveBeenCalled();
    expect(report.failed).toBe(1);
    expect(report.succeeded).toBe(1);
    expect(report.results.find((r) => r.name === 'bad')?.error).toBe('boom');
  });

  it('honours shouldRun', async () => {
    const warm = jest.fn().mockResolvedValue(undefined);
    service.register({
      name: 'gated',
      priority: 1,
      warm,
      shouldRun: () => false,
    });

    const report = await service.warmAll();

    expect(warm).not.toHaveBeenCalled();
    expect(report.skipped).toBe(1);
    expect(report.results[0].status).toBe('skipped');
  });

  it('supports an async shouldRun', async () => {
    const warm = jest.fn().mockResolvedValue(undefined);
    service.register({
      name: 'gated',
      priority: 1,
      warm,
      shouldRun: async () => true,
    });

    await service.warmAll();
    expect(warm).toHaveBeenCalled();
  });

  it('times out a hung warmer instead of blocking forever', async () => {
    service.register({
      name: 'hung',
      priority: 1,
      warm: () => new Promise(() => { /* never settles */ }),
    });

    const report = await service.warmAll({ timeoutMs: 20 });

    expect(report.results[0].status).toBe('timed-out');
    expect(report.failed).toBe(1);
  });

  it('replaces a warmer registered under the same name', async () => {
    const first = jest.fn().mockResolvedValue(undefined);
    const second = jest.fn().mockResolvedValue(undefined);
    service.register({ name: 'dup', priority: 1, warm: first });
    service.register({ name: 'dup', priority: 1, warm: second });

    await service.warmAll();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(service.list()).toHaveLength(1);
  });

  it('unregisters a warmer', async () => {
    const warm = jest.fn().mockResolvedValue(undefined);
    service.register({ name: 'x', priority: 1, warm });
    service.unregister('x');

    const report = await service.warmAll();
    expect(warm).not.toHaveBeenCalled();
    expect(report.results).toHaveLength(0);
  });

  it('runs a single warmer by name', async () => {
    const target = jest.fn().mockResolvedValue(undefined);
    const other = jest.fn().mockResolvedValue(undefined);
    service.register({ name: 'target', priority: 1, warm: target });
    service.register({ name: 'other', priority: 1, warm: other });

    const result = await service.warmOne('target');

    expect(result.status).toBe('ok');
    expect(target).toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });

  it('reports an unknown warmer rather than throwing', async () => {
    const result = await service.warmOne('missing');
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/no warmer registered/);
  });

  it('reports an empty run cleanly', async () => {
    const report = await service.warmAll();
    expect(report.results).toEqual([]);
    expect(report.succeeded).toBe(0);
  });

  it('respects the concurrency cap', async () => {
    let active = 0;
    let peak = 0;
    for (let i = 0; i < 6; i += 1) {
      service.register({
        name: `w${i}`,
        priority: 1,
        warm: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
        },
      });
    }

    await service.warmAll({ concurrency: 2 });

    // Warming must not become the load spike it exists to prevent.
    expect(peak).toBeLessThanOrEqual(2);
  });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

describe('namespaceOf', () => {
  it('takes the segment before the first colon', () => {
    expect(namespaceOf('mentor:42:profile')).toBe('mentor');
  });

  it('treats a key with no colon as its own namespace', () => {
    expect(namespaceOf('health')).toBe('health');
  });
});

describe('CacheAnalyticsService', () => {
  let analytics: CacheAnalyticsService;

  const feed = (events: Array<Partial<CacheEvent> & { type: CacheEvent['type'] }>) => {
    for (const e of events) {
      analytics.record({ key: 'mentor:1', ...e } as CacheEvent);
    }
  };

  beforeEach(() => {
    analytics = new CacheAnalyticsService();
  });

  it('tracks hits and misses per namespace', () => {
    analytics.record({ type: 'hit', key: 'mentor:1' });
    analytics.record({ type: 'miss', key: 'mentor:2' });
    analytics.record({ type: 'hit', key: 'session:9' });

    expect(analytics.statsFor('mentor')?.hits).toBe(1);
    expect(analytics.statsFor('mentor')?.misses).toBe(1);
    expect(analytics.statsFor('session')?.hits).toBe(1);
  });

  it('computes hit rate', () => {
    feed([{ type: 'hit' }, { type: 'hit' }, { type: 'hit' }, { type: 'miss' }]);
    expect(analytics.statsFor('mentor')?.hitRate).toBeCloseTo(0.75);
  });

  it('reports a null hit rate before any read', () => {
    analytics.record({ type: 'set', key: 'mentor:1' });
    expect(analytics.statsFor('mentor')?.hitRate).toBeNull();
  });

  it('breaks hits down by layer', () => {
    analytics.record({ type: 'hit', key: 'mentor:1', layer: 'L1' });
    analytics.record({ type: 'hit', key: 'mentor:2', layer: 'L2' });
    analytics.record({ type: 'hit', key: 'mentor:3', layer: 'L1' });

    expect(analytics.statsFor('mentor')?.hitsByLayer).toEqual({ L1: 2, L2: 1 });
  });

  it('does not count promotions as reads', () => {
    analytics.record({ type: 'promote', key: 'mentor:1', layer: 'L1' });
    // Counting an internal mechanic as a hit would inflate the rate the
    // recommendations key off.
    expect(analytics.statsFor('mentor')?.hitRate).toBeNull();
  });

  it('averages lookup duration across reads', () => {
    analytics.record({ type: 'hit', key: 'mentor:1', durationMs: 10 });
    analytics.record({ type: 'miss', key: 'mentor:2', durationMs: 30 });

    expect(analytics.statsFor('mentor')?.avgLookupMs).toBeCloseTo(20);
  });

  it('returns null for an unknown namespace', () => {
    expect(analytics.statsFor('nope')).toBeNull();
  });

  it('orders allStats by traffic', () => {
    analytics.record({ type: 'hit', key: 'quiet:1' });
    for (let i = 0; i < 5; i += 1) analytics.record({ type: 'hit', key: 'busy:1' });

    expect(analytics.allStats()[0].namespace).toBe('busy');
  });

  describe('recommendations', () => {
    it('stays silent below the sample threshold', () => {
      feed([{ type: 'miss' }, { type: 'miss' }]);
      // A recommendation engine that fires on noise gets ignored.
      expect(analytics.recommendations()).toEqual([]);
    });

    it('suggests a longer TTL when misses dominate but data is reused', () => {
      for (let i = 0; i < 20; i += 1) analytics.record({ type: 'miss', key: 'mentor:1' });
      for (let i = 0; i < 10; i += 1) analytics.record({ type: 'hit', key: 'mentor:1' });

      const kinds = analytics.recommendations().map((r) => r.kind);
      expect(kinds).toContain('increase-ttl');
    });

    it('suggests reconsidering caching for a churning namespace', () => {
      for (let i = 0; i < 30; i += 1) analytics.record({ type: 'miss', key: 'churn:1' });
      for (let i = 0; i < 2; i += 1) analytics.record({ type: 'hit', key: 'churn:1' });
      for (let i = 0; i < 30; i += 1) analytics.record({ type: 'set', key: 'churn:1' });

      const rec = analytics.recommendations().find((r) => r.namespace === 'churn');
      expect(rec?.kind).toBe('reconsider-caching');
    });

    it('flags an unhealthy layer', () => {
      for (let i = 0; i < 50; i += 1) analytics.record({ type: 'hit', key: 'mentor:1' });
      for (let i = 0; i < 10; i += 1) analytics.record({ type: 'error', key: 'mentor:1' });

      const kinds = analytics.recommendations().map((r) => r.kind);
      expect(kinds).toContain('investigate-errors');
    });

    it('suggests warming a high-traffic namespace with many misses', () => {
      for (let i = 0; i < 80; i += 1) analytics.record({ type: 'hit', key: 'mentor:1' });
      for (let i = 0; i < 40; i += 1) analytics.record({ type: 'miss', key: 'mentor:1' });

      const kinds = analytics.recommendations().map((r) => r.kind);
      expect(kinds).toContain('add-warming');
    });

    it('suggests L1 tuning when hits come mostly from L2', () => {
      for (let i = 0; i < 50; i += 1) {
        analytics.record({ type: 'hit', key: 'mentor:1', layer: 'L2' });
      }
      analytics.record({ type: 'hit', key: 'mentor:1', layer: 'L1' });

      const kinds = analytics.recommendations().map((r) => r.kind);
      expect(kinds).toContain('promote-to-l1');
    });

    it('sorts recommendations by impact', () => {
      for (let i = 0; i < 50; i += 1) analytics.record({ type: 'miss', key: 'mentor:1' });
      for (let i = 0; i < 10; i += 1) analytics.record({ type: 'error', key: 'mentor:1' });

      const recs = analytics.recommendations();
      expect(recs[0].impact).toBeGreaterThanOrEqual(recs[recs.length - 1].impact);
    });
  });

  it('resets', () => {
    feed([{ type: 'hit' }]);
    analytics.reset();
    expect(analytics.allStats()).toEqual([]);
  });
});

// ─── Dependency graph ─────────────────────────────────────────────────────────

describe('CacheDependencyGraph', () => {
  let graph: CacheDependencyGraph;

  beforeEach(() => {
    graph = new CacheDependencyGraph();
  });

  it('resolves keys registered against an entity', () => {
    graph.register({ key: 'a', dependsOn: ['mentor:1'] });
    graph.register({ key: 'b', dependsOn: ['mentor:1'] });
    graph.register({ key: 'c', dependsOn: ['mentor:2'] });

    expect(graph.resolveInvalidations('mentor:1').sort()).toEqual(['a', 'b']);
  });

  it('replaces dependencies when a key is re-registered', () => {
    graph.register({ key: 'a', dependsOn: ['mentor:1'] });
    graph.register({ key: 'a', dependsOn: ['mentor:2'] });

    // Accumulating stale edges would slowly turn invalidation into a purge.
    expect(graph.resolveInvalidations('mentor:1')).toEqual([]);
    expect(graph.resolveInvalidations('mentor:2')).toEqual(['a']);
  });

  it('deregisters a key', () => {
    graph.register({ key: 'a', dependsOn: ['mentor:1'] });
    graph.deregister('a');
    expect(graph.resolveInvalidations('mentor:1')).toEqual([]);
  });

  it('cascades through linked entities', () => {
    graph.register({ key: 'listing', dependsOn: ['category:5'] });
    graph.link('mentor:1', 'category:5');

    expect(graph.resolveInvalidations('mentor:1')).toEqual(['listing']);
  });

  it('terminates on a cycle', () => {
    graph.register({ key: 'a', dependsOn: ['x'] });
    graph.register({ key: 'b', dependsOn: ['y'] });
    graph.link('x', 'y');
    graph.link('y', 'x');

    // Must not hang.
    expect(graph.resolveInvalidations('x').sort()).toEqual(['a', 'b']);
  });

  it('ignores a self-link', () => {
    graph.register({ key: 'a', dependsOn: ['x'] });
    graph.link('x', 'x');
    expect(graph.resolveInvalidations('x')).toEqual(['a']);
  });

  it('de-duplicates a key reachable by two paths', () => {
    graph.register({ key: 'a', dependsOn: ['x', 'y'] });
    graph.link('root', 'x');
    graph.link('root', 'y');

    expect(graph.resolveInvalidations('root')).toEqual(['a']);
  });

  it('resolves several entities at once', () => {
    graph.register({ key: 'a', dependsOn: ['x'] });
    graph.register({ key: 'b', dependsOn: ['y'] });

    expect(graph.resolveMany(['x', 'y']).sort()).toEqual(['a', 'b']);
  });

  it('ignores an empty dependency list', () => {
    graph.register({ key: 'a', dependsOn: [] });
    expect(graph.stats().trackedKeys).toBe(0);
  });

  it('reports stats and clears', () => {
    graph.register({ key: 'a', dependsOn: ['x', 'y'] });
    graph.link('x', 'z');

    const stats = graph.stats();
    expect(stats.trackedKeys).toBe(1);
    expect(stats.edges).toBeGreaterThan(0);

    graph.clear();
    expect(graph.stats().trackedKeys).toBe(0);
  });
});
