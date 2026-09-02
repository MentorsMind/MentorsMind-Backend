/**
 * Scaling optimiser loop tests (issue #862).
 *
 * Driven through a fake `ScalingProvider`, so the loop, SLA accounting and
 * failure handling are all verified without a cloud account.
 */

import {
  ScalingOptimizerWorker,
  type ScalingProvider,
} from '../scaling-optimizer.worker';
import { DEFAULT_POLICY } from '../../services/auto-scaler.service';
import { LoadPredictorService } from '../../services/load-predictor.service';

class FakeProvider implements ScalingProvider {
  readonly name = 'fake';
  instances = 4;
  load = 100;
  setCalls: number[] = [];
  failOn: Set<'instances' | 'load' | 'set'> = new Set();

  async getCurrentInstances(): Promise<number> {
    if (this.failOn.has('instances')) throw new Error('control plane down');
    return this.instances;
  }

  async getCurrentLoad(): Promise<number> {
    if (this.failOn.has('load')) throw new Error('metrics unreachable');
    return this.load;
  }

  async setInstances(count: number): Promise<void> {
    if (this.failOn.has('set')) throw new Error('scale request rejected');
    this.setCalls.push(count);
    this.instances = count;
  }
}

describe('ScalingOptimizerWorker', () => {
  let provider: FakeProvider;
  let clock: number;

  const build = (over: Partial<ConstructorParameters<typeof ScalingOptimizerWorker>[0]> = {}) =>
    new ScalingOptimizerWorker({
      provider,
      now: () => clock,
      ...over,
    });

  beforeEach(() => {
    provider = new FakeProvider();
    clock = Date.UTC(2026, 0, 4, 12, 0, 0);
  });

  describe('tick', () => {
    it('holds when capacity matches load', async () => {
      provider.instances = 4;
      provider.load = 280; // 4 x 70 usable

      const result = await build().tick();

      expect(result?.decision.action).toBe('hold');
      expect(provider.setCalls).toEqual([]);
    });

    it('scales up and applies the change through the provider', async () => {
      provider.instances = 2;
      provider.load = 900;

      const result = await build().tick();

      expect(result?.decision.action).toBe('scale-up');
      expect(provider.setCalls).toHaveLength(1);
      expect(provider.instances).toBeGreaterThan(2);
    });

    it('feeds each observation to the predictor', async () => {
      const predictor = new LoadPredictorService();
      const worker = build({ predictor });

      await worker.tick();
      clock += 30_000;
      await worker.tick();

      expect(predictor.sampleCount()).toBe(2);
    });

    it('reads the live instance count each tick rather than trusting its own state', async () => {
      const worker = build();
      await worker.tick();

      // Something else (a manual change, another controller) resized the group.
      provider.instances = 9;
      const result = await worker.tick();

      expect(result?.state.currentInstances).toBeGreaterThanOrEqual(1);
      expect(result?.decision.currentInstances).toBe(9);
    });
  });

  describe('failure handling', () => {
    it('returns null and reports when metrics are unreachable', async () => {
      provider.failOn.add('load');
      const errors: Error[] = [];

      const result = await build({ onError: (e) => errors.push(e) }).tick();

      // A brief metrics outage must not kill the worker and freeze the cluster.
      expect(result).toBeNull();
      expect(errors).toHaveLength(1);
    });

    it('reports a rejected scale request without throwing', async () => {
      provider.instances = 2;
      provider.load = 900;
      provider.failOn.add('set');
      const errors: Error[] = [];

      await expect(
        build({ onError: (e) => errors.push(e) }).tick(),
      ).resolves.toBeNull();
      expect(errors[0].message).toMatch(/scale request rejected/);
    });

    it('keeps ticking after a failure', async () => {
      const worker = build({ onError: () => undefined });

      provider.failOn.add('load');
      await worker.tick();

      provider.failOn.clear();
      clock += 30_000;
      await expect(worker.tick()).resolves.not.toBeNull();
    });
  });

  describe('SLA accounting', () => {
    it('records a breach when load exceeds in-place capacity', async () => {
      provider.instances = 1;
      provider.load = 500; // capacity is 100

      const worker = build();
      const result = await worker.tick();

      expect(result?.slaBreach).toBe(true);
      expect(worker.slaSnapshot().breached).toBe(1);
    });

    it('judges against capacity in place, not capacity just requested', async () => {
      provider.instances = 1;
      provider.load = 500;

      const worker = build();
      await worker.tick();

      // The scale-up was issued this tick, but those instances are not serving
      // traffic yet — counting them would hide the breach.
      expect(worker.slaSnapshot().breached).toBe(1);
      expect(worker.slaSnapshot().satisfied).toBe(0);
    });

    it('computes attainment across ticks', async () => {
      const worker = build({ policy: { ...DEFAULT_POLICY, maxInstances: 1, minInstances: 1 } });

      provider.instances = 1;
      provider.load = 50; // satisfied
      await worker.tick();

      clock += 30_000;
      provider.instances = 1;
      provider.load = 500; // breached
      await worker.tick();

      expect(worker.slaSnapshot().attainment).toBeCloseTo(0.5);
    });

    it('reports null attainment before any tick', () => {
      expect(build().slaSnapshot().attainment).toBeNull();
    });
  });

  describe('cost accounting', () => {
    it('accumulates instance-ticks', async () => {
      provider.instances = 3;
      provider.load = 100;

      const worker = build();
      await worker.tick();
      clock += 30_000;
      await worker.tick();

      expect(worker.costUnits()).toBeGreaterThanOrEqual(3);
    });
  });

  describe('lifecycle', () => {
    it('start/stop toggles the running flag', () => {
      const worker = build({ intervalMs: 10_000 });

      expect(worker.isRunning()).toBe(false);
      worker.start();
      expect(worker.isRunning()).toBe(true);
      worker.stop();
      expect(worker.isRunning()).toBe(false);
    });

    it('start is idempotent', () => {
      const worker = build({ intervalMs: 10_000 });
      worker.start();
      worker.start();
      worker.stop();
      expect(worker.isRunning()).toBe(false);
    });

    it('stop before start is safe', () => {
      expect(() => build().stop()).not.toThrow();
    });
  });
});
