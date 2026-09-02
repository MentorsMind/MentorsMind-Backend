/**
 * Edge routing and image negotiation tests (issue #863).
 */

import {
  EdgeFunctionsService,
  matchRoute,
  routeSpecificity,
  type EdgeDeploymentManifest,
  type EdgeDeploymentTarget,
} from '../edge-functions.service';
import {
  DEFAULT_BREAKPOINTS,
  IMAGE_VARY_HEADER,
  buildSrcSet,
  negotiateFormat,
  parseAcceptHeader,
  planOptimization,
  planVariants,
} from '../image-optimizer.service';

// ─── Route matching ───────────────────────────────────────────────────────────

describe('matchRoute', () => {
  it('matches an exact path', () => {
    expect(matchRoute('/api/health', '/api/health')).toEqual({});
  });

  it('rejects a different path', () => {
    expect(matchRoute('/api/health', '/api/status')).toBeNull();
  });

  it('captures named params', () => {
    expect(matchRoute('/mentors/:id/profile', '/mentors/42/profile')).toEqual({
      id: '42',
    });
  });

  it('decodes an encoded param', () => {
    expect(matchRoute('/search/:term', '/search/data%20science')).toEqual({
      term: 'data science',
    });
  });

  it('does not let a shorter pattern match a longer path', () => {
    // Otherwise `/a` would intercept everything beneath it.
    expect(matchRoute('/assets', '/assets/img/logo.png')).toBeNull();
  });

  it('absorbs the remainder with a trailing wildcard', () => {
    expect(matchRoute('/assets/*', '/assets/img/logo.png')).toEqual({});
  });

  it('lets a wildcard match an empty remainder', () => {
    expect(matchRoute('/assets/*', '/assets')).toEqual({});
  });

  it('ignores leading and repeated slashes', () => {
    expect(matchRoute('/a/b', 'a/b')).toEqual({});
  });
});

describe('routeSpecificity', () => {
  it('ranks literals above params above wildcards', () => {
    expect(routeSpecificity('/a/b')).toBeGreaterThan(routeSpecificity('/a/:b'));
    expect(routeSpecificity('/a/:b')).toBeGreaterThan(routeSpecificity('/a/*'));
  });
});

// ─── Edge function registry ───────────────────────────────────────────────────

describe('EdgeFunctionsService', () => {
  let service: EdgeFunctionsService;

  beforeEach(() => {
    service = new EdgeFunctionsService();
  });

  const fn = (over: Partial<Parameters<EdgeFunctionsService['register']>[0]> = {}) => ({
    name: 'test-fn',
    trigger: 'viewer-request' as const,
    route: '/api/*',
    ...over,
  });

  describe('registration', () => {
    it('registers and lists', () => {
      service.register(fn());
      expect(service.list()).toHaveLength(1);
    });

    it('rejects an empty name', () => {
      expect(() => service.register(fn({ name: '  ' }))).toThrow(/name/);
    });

    it('rejects an empty route', () => {
      expect(() => service.register(fn({ route: '' }))).toThrow(/route/);
    });

    it('rejects multiple wildcards', () => {
      // Fail at registration, not minutes later at deploy time.
      expect(() => service.register(fn({ route: '/a/*/b/*' }))).toThrow(/wildcard/);
    });

    it('replaces a function registered under the same name', () => {
      service.register(fn({ route: '/one' }));
      service.register(fn({ route: '/two' }));
      expect(service.list()).toHaveLength(1);
      expect(service.list()[0].route).toBe('/two');
    });

    it('unregisters', () => {
      service.register(fn());
      service.unregister('test-fn');
      expect(service.list()).toHaveLength(0);
    });
  });

  describe('resolve', () => {
    it('finds a matching function for the trigger', () => {
      service.register(fn({ route: '/api/:version/mentors' }));
      const match = service.resolve('viewer-request', '/api/v1/mentors');

      expect(match?.definition.name).toBe('test-fn');
      expect(match?.params).toEqual({ version: 'v1' });
    });

    it('ignores functions bound to a different trigger', () => {
      service.register(fn({ trigger: 'origin-response' }));
      expect(service.resolve('viewer-request', '/api/x')).toBeNull();
    });

    it('skips a disabled function', () => {
      service.register(fn({ enabled: false }));
      expect(service.resolve('viewer-request', '/api/x')).toBeNull();
    });

    it('prefers the more specific route regardless of registration order', () => {
      service.register(fn({ name: 'catch-all', route: '/api/*' }));
      service.register(fn({ name: 'exact', route: '/api/health' }));

      expect(service.resolve('viewer-request', '/api/health')?.definition.name).toBe(
        'exact',
      );
    });

    it('lets explicit priority beat specificity', () => {
      service.register(fn({ name: 'exact', route: '/api/health' }));
      service.register(fn({ name: 'override', route: '/api/*', priority: 10 }));

      expect(service.resolve('viewer-request', '/api/health')?.definition.name).toBe(
        'override',
      );
    });

    it('returns null when nothing matches', () => {
      service.register(fn({ route: '/api/*' }));
      expect(service.resolve('viewer-request', '/static/x')).toBeNull();
    });
  });

  describe('resolveAll', () => {
    it('returns every match, highest precedence first', () => {
      service.register(fn({ name: 'broad', route: '/api/*' }));
      service.register(fn({ name: 'exact', route: '/api/health' }));

      const names = service
        .resolveAll('viewer-request', '/api/health')
        .map((m) => m.definition.name);
      expect(names).toEqual(['exact', 'broad']);
    });
  });

  describe('toggling', () => {
    it('enables and disables in place', () => {
      service.register(fn());
      expect(service.setEnabled('test-fn', false)).toBe(true);
      expect(service.resolve('viewer-request', '/api/x')).toBeNull();

      service.setEnabled('test-fn', true);
      expect(service.resolve('viewer-request', '/api/x')).not.toBeNull();
    });

    it('reports an unknown name', () => {
      expect(service.setEnabled('ghost', false)).toBe(false);
    });
  });

  describe('manifest', () => {
    it('applies platform defaults', () => {
      service.register(fn());
      const manifest = service.buildManifest('cloudflare');

      expect(manifest.functions[0].memoryMb).toBe(128);
      expect(manifest.functions[0].timeoutMs).toBe(50);
    });

    it('excludes disabled functions', () => {
      service.register(fn({ name: 'on' }));
      service.register(fn({ name: 'off', enabled: false }));

      // Deploying an inactive function wastes PoP memory and makes the
      // deployed set differ from the intended one.
      expect(service.buildManifest('fastly').functions.map((f) => f.name)).toEqual(['on']);
    });

    it('orders by descending priority', () => {
      service.register(fn({ name: 'low', priority: 1 }));
      service.register(fn({ name: 'high', priority: 9 }));

      expect(service.buildManifest('cloudflare').functions[0].name).toBe('high');
    });

    it('stamps the generation time', () => {
      service.register(fn());
      const at = new Date('2026-08-27T10:00:00.000Z');
      expect(service.buildManifest('cloudflare', at).generatedAt).toBe(at.toISOString());
    });
  });

  it('deploys through a target adapter', async () => {
    const received: EdgeDeploymentManifest[] = [];
    const target: EdgeDeploymentTarget = {
      provider: 'cloudflare',
      deploy: async (m) => {
        received.push(m);
      },
    };

    service.register(fn());
    await service.deploy(target);

    expect(received).toHaveLength(1);
    expect(received[0].provider).toBe('cloudflare');
  });
});

// ─── Image negotiation ────────────────────────────────────────────────────────

describe('parseAcceptHeader', () => {
  it('returns nothing for a missing header', () => {
    expect(parseAcceptHeader(undefined).size).toBe(0);
    expect(parseAcceptHeader('').size).toBe(0);
  });

  it('reads explicit image types', () => {
    const set = parseAcceptHeader('image/avif,image/webp,image/jpeg');
    expect([...set].sort()).toEqual(['avif', 'jpeg', 'webp']);
  });

  it('treats a wildcard as modern-format capable', () => {
    expect(parseAcceptHeader('image/*').has('webp')).toBe(true);
  });

  it('honours an explicit q=0 refusal', () => {
    expect(parseAcceptHeader('image/webp;q=0,image/jpeg').has('webp')).toBe(false);
  });

  it('ignores a malformed q rather than dropping the format', () => {
    // A typo'd header should not silently degrade quality.
    expect(parseAcceptHeader('image/webp;q=abc').has('webp')).toBe(true);
  });

  it('is case-insensitive and tolerant of spacing', () => {
    expect(parseAcceptHeader(' IMAGE/WEBP , image/jpeg ').has('webp')).toBe(true);
  });
});

describe('negotiateFormat', () => {
  it('prefers AVIF when offered', () => {
    expect(negotiateFormat('image/avif,image/webp,image/jpeg').format).toBe('avif');
  });

  it('falls back to WebP', () => {
    expect(negotiateFormat('image/webp,image/jpeg').format).toBe('webp');
  });

  it('falls back to JPEG for an old client', () => {
    expect(negotiateFormat('image/jpeg').format).toBe('jpeg');
  });

  it('uses JPEG when the header says nothing', () => {
    // Serving a format the client never claimed breaks the image silently.
    expect(negotiateFormat(undefined).format).toBe('jpeg');
  });

  it('never flattens transparency to JPEG', () => {
    const result = negotiateFormat('image/jpeg', { sourceHasAlpha: true });
    expect(result.format).toBe('png');
    expect(result.reason).toMatch(/transparency/i);
  });

  it('still prefers WebP for a transparent source when accepted', () => {
    // WebP carries alpha, so there is no reason to drop to PNG.
    expect(negotiateFormat('image/webp,image/jpeg', { sourceHasAlpha: true }).format).toBe(
      'webp',
    );
  });

  it('uses PNG when it is the only accepted format', () => {
    expect(negotiateFormat('image/png').format).toBe('png');
  });

  it('explains its choice', () => {
    expect(negotiateFormat('image/avif').reason).toBeTruthy();
  });
});

describe('planVariants', () => {
  it('includes breakpoints below the source width', () => {
    expect(planVariants(1200).map((v) => v.width)).toEqual([320, 640, 1024, 1200]);
  });

  it('never upscales', () => {
    // A 1600px variant from a 400px source is blurry *and* bigger.
    expect(planVariants(400).map((v) => v.width)).toEqual([320, 400]);
  });

  it('always includes an exact-fit variant', () => {
    expect(planVariants(500).some((v) => v.width === 500)).toBe(true);
  });

  it('returns a single variant for a tiny source', () => {
    expect(planVariants(100)).toEqual([{ width: 100, suffix: '-100w' }]);
  });

  it('returns nothing for an invalid width', () => {
    expect(planVariants(0)).toEqual([]);
    expect(planVariants(Number.NaN)).toEqual([]);
  });

  it('accepts custom breakpoints', () => {
    expect(planVariants(900, [200, 400]).map((v) => v.width)).toEqual([200, 400, 900]);
  });

  it('exposes sensible defaults', () => {
    expect(DEFAULT_BREAKPOINTS.length).toBeGreaterThan(2);
  });
});

describe('buildSrcSet', () => {
  it('emits width descriptors', () => {
    const srcset = buildSrcSet('/img/hero', planVariants(700), 'webp');
    expect(srcset).toContain('/img/hero-320w.webp 320w');
    expect(srcset).toContain('/img/hero-700w.webp 700w');
  });

  it('returns empty for no variants', () => {
    // So the caller omits the attribute rather than emitting srcset="".
    expect(buildSrcSet('/img/x', [], 'webp')).toBe('');
  });
});

describe('planOptimization', () => {
  it('combines negotiation and variant planning', () => {
    const plan = planOptimization({
      sourceWidth: 1200,
      acceptHeader: 'image/avif,image/webp',
    });

    expect(plan.format).toBe('avif');
    expect(plan.variants.length).toBeGreaterThan(1);
    expect(plan.singleVariant).toBe(false);
  });

  it('uses a lower default quality for AVIF than JPEG', () => {
    const avif = planOptimization({ sourceWidth: 800, acceptHeader: 'image/avif' });
    const jpeg = planOptimization({ sourceWidth: 800, acceptHeader: 'image/jpeg' });

    // One quality number across formats bloats the modern ones.
    expect(avif.quality).toBeLessThan(jpeg.quality);
  });

  it('honours a quality override within bounds', () => {
    expect(planOptimization({ sourceWidth: 800, qualityOverride: 60 }).quality).toBe(60);
    expect(planOptimization({ sourceWidth: 800, qualityOverride: 500 }).quality).toBe(100);
    expect(planOptimization({ sourceWidth: 800, qualityOverride: -5 }).quality).toBe(1);
  });

  it('flags a single-variant plan', () => {
    expect(planOptimization({ sourceWidth: 80 }).singleVariant).toBe(true);
  });
});

describe('IMAGE_VARY_HEADER', () => {
  it('varies on Accept', () => {
    // Without this a shared cache serves AVIF to a client that cannot decode it.
    expect(IMAGE_VARY_HEADER).toBe('Accept');
  });
});
