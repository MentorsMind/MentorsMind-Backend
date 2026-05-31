import { FeatureFlagService, FeatureFlag } from '../../services/feature-flag.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../utils/logger.utils', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const mockQuery = jest.fn();
jest.mock('../../config/database', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'flag-id-1',
    key: 'test-flag',
    name: 'Test Flag',
    description: null,
    enabled: true,
    rollout_percentage: '50',
    targeting: {},
    variants: [],
    created_by: null,
    updated_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FeatureFlagService.create', () => {
  it('inserts a flag and returns mapped result', async () => {
    const row = makeRow({ enabled: false, rollout_percentage: '0' });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const flag = await FeatureFlagService.create({ key: 'test-flag', name: 'Test Flag' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(flag.key).toBe('test-flag');
    expect(flag.enabled).toBe(false);
    expect(flag.rolloutPercentage).toBe(0);
  });
});

describe('FeatureFlagService.findByKey', () => {
  it('returns flag when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });
    const flag = await FeatureFlagService.findByKey('test-flag');
    expect(flag).not.toBeNull();
    expect(flag!.key).toBe('test-flag');
  });

  it('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const flag = await FeatureFlagService.findByKey('missing');
    expect(flag).toBeNull();
  });
});

describe('FeatureFlagService.update', () => {
  it('builds SET clause and returns updated flag', async () => {
    const row = makeRow({ enabled: false });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const flag = await FeatureFlagService.update('flag-id-1', { enabled: false, updatedBy: 'admin-1' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain('UPDATE feature_flags');
    expect(flag!.enabled).toBe(false);
  });

  it('returns null when flag not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const flag = await FeatureFlagService.update('nonexistent', { enabled: false });
    expect(flag).toBeNull();
  });
});

describe('FeatureFlagService.delete', () => {
  it('returns true when row deleted', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect(await FeatureFlagService.delete('flag-id-1')).toBe(true);
  });

  it('returns false when row not found', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect(await FeatureFlagService.delete('nonexistent')).toBe(false);
  });
});

describe('FeatureFlagService.isEnabled', () => {
  const mockFlag = (overrides: Partial<FeatureFlag> = {}): FeatureFlag => ({
    id: 'id',
    key: 'test-flag',
    name: 'Test',
    enabled: true,
    rolloutPercentage: 100,
    targeting: {},
    variants: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it('returns false when flag is disabled', async () => {
    jest.spyOn(FeatureFlagService, 'findByKey').mockResolvedValueOnce(mockFlag({ enabled: false }));
    expect(await FeatureFlagService.isEnabled('test-flag', 'user-1')).toBe(false);
  });

  it('returns false when flag not found', async () => {
    jest.spyOn(FeatureFlagService, 'findByKey').mockResolvedValueOnce(null);
    expect(await FeatureFlagService.isEnabled('missing', 'user-1')).toBe(false);
  });

  it('returns true when user is in targeting.userIds', async () => {
    jest.spyOn(FeatureFlagService, 'findByKey').mockResolvedValueOnce(
      mockFlag({ rolloutPercentage: 0, targeting: { userIds: ['user-1'] } }),
    );
    expect(await FeatureFlagService.isEnabled('test-flag', 'user-1')).toBe(true);
  });

  it('returns true when rolloutPercentage is 100', async () => {
    jest.spyOn(FeatureFlagService, 'findByKey').mockResolvedValueOnce(mockFlag({ rolloutPercentage: 100 }));
    expect(await FeatureFlagService.isEnabled('test-flag', 'user-1')).toBe(true);
  });

  it('returns false when rolloutPercentage is 0', async () => {
    jest.spyOn(FeatureFlagService, 'findByKey').mockResolvedValueOnce(mockFlag({ rolloutPercentage: 0 }));
    expect(await FeatureFlagService.isEnabled('test-flag', 'user-1')).toBe(false);
  });

  it('is deterministic for the same user+flag', async () => {
    const flag = mockFlag({ rolloutPercentage: 50 });
    jest.spyOn(FeatureFlagService, 'findByKey').mockResolvedValue(flag);

    const first = await FeatureFlagService.isEnabled('test-flag', 'stable-user');
    const second = await FeatureFlagService.isEnabled('test-flag', 'stable-user');
    expect(first).toBe(second);
  });

  it('returns true when user segment matches targeting', async () => {
    jest.spyOn(FeatureFlagService, 'findByKey').mockResolvedValueOnce(
      mockFlag({ rolloutPercentage: 0, targeting: { userSegments: ['beta'] } }),
    );
    expect(await FeatureFlagService.isEnabled('test-flag', 'user-1', { segment: 'beta' })).toBe(true);
  });

  it('returns false on error (fail-safe)', async () => {
    jest.spyOn(FeatureFlagService, 'findByKey').mockRejectedValueOnce(new Error('DB error'));
    expect(await FeatureFlagService.isEnabled('test-flag', 'user-1')).toBe(false);
  });
});

describe('FeatureFlagService.getVariant', () => {
  it('returns null when flag is disabled', async () => {
    jest.spyOn(FeatureFlagService, 'isEnabled').mockResolvedValueOnce(false);
    expect(await FeatureFlagService.getVariant('test-flag', 'user-1')).toBeNull();
  });

  it('returns null when flag has no variants', async () => {
    jest.spyOn(FeatureFlagService, 'isEnabled').mockResolvedValueOnce(true);
    jest.spyOn(FeatureFlagService, 'findByKey').mockResolvedValueOnce({
      id: 'id', key: 'test-flag', name: 'Test', enabled: true,
      rolloutPercentage: 100, targeting: {}, variants: [],
      createdAt: new Date(), updatedAt: new Date(),
    });
    expect(await FeatureFlagService.getVariant('test-flag', 'user-1')).toBeNull();
  });

  it('returns a variant from the weighted list', async () => {
    jest.spyOn(FeatureFlagService, 'isEnabled').mockResolvedValueOnce(true);
    jest.spyOn(FeatureFlagService, 'findByKey').mockResolvedValueOnce({
      id: 'id', key: 'test-flag', name: 'Test', enabled: true,
      rolloutPercentage: 100, targeting: {},
      variants: [
        { name: 'control', weight: 50, config: {} },
        { name: 'treatment', weight: 50, config: { newUi: true } },
      ],
      createdAt: new Date(), updatedAt: new Date(),
    });
    const variant = await FeatureFlagService.getVariant('test-flag', 'user-1');
    expect(variant).not.toBeNull();
    expect(['control', 'treatment']).toContain(variant!.name);
  });

  it('returns null on error (fail-safe)', async () => {
    jest.spyOn(FeatureFlagService, 'isEnabled').mockRejectedValueOnce(new Error('DB error'));
    expect(await FeatureFlagService.getVariant('test-flag', 'user-1')).toBeNull();
  });
});

describe('FeatureFlagService.trackEvent', () => {
  it('inserts an experiment event', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await FeatureFlagService.trackEvent('test-flag', 'user-1', 'exposure', 'control');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO experiment_events');
  });

  it('does not throw on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));
    await expect(FeatureFlagService.trackEvent('test-flag', 'user-1', 'conversion')).resolves.toBeUndefined();
  });
});

describe('FeatureFlagService.getMetrics', () => {
  it('aggregates exposures and conversions correctly', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { variant: 'control', event_type: 'exposure', count: '80' },
        { variant: 'control', event_type: 'conversion', count: '20' },
        { variant: 'treatment', event_type: 'exposure', count: '80' },
        { variant: 'treatment', event_type: 'conversion', count: '40' },
      ],
    });

    const metrics = await FeatureFlagService.getMetrics('test-flag');

    expect(metrics.exposures).toBe(160);
    expect(metrics.conversions).toBe(60);
    expect(metrics.conversionRate).toBeCloseTo(60 / 160);
    expect(metrics.variantBreakdown['control'].exposures).toBe(80);
    expect(metrics.variantBreakdown['treatment'].conversions).toBe(40);
  });

  it('returns zero metrics when no events', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const metrics = await FeatureFlagService.getMetrics('empty-flag');
    expect(metrics.exposures).toBe(0);
    expect(metrics.conversionRate).toBe(0);
  });
});
