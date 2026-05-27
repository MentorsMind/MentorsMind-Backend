/**
 * API Deprecation Utility
 * 
 * Manages API endpoint deprecation with proper headers, tracking,
 * and migration path documentation.
 */

import { logWarning, addBreadcrumb } from './error.utils';

type Response = any;

export interface DeprecationConfig {
  endpoint: string;
  deprecatedDate: Date;
  sunsetDate: Date;
  replacementEndpoint?: string;
  migrationGuide?: string;
  reason?: string;
}

export interface DeprecationRegistry {
  [endpoint: string]: DeprecationConfig;
}

class DeprecationManager {
  private registry: DeprecationRegistry = {};
  private readonly DEPRECATION_DURATION_MONTHS = 6;

  /**
   * Register a deprecated endpoint
   */
  registerDeprecation(config: DeprecationConfig): void {
    // Validate sunset date is at least 6 months from now
    const minSunsetDate = new Date();
    minSunsetDate.setMonth(minSunsetDate.getMonth() + this.DEPRECATION_DURATION_MONTHS);

    if (config.sunsetDate < minSunsetDate) {
      throw new Error(
        `Sunset date must be at least ${this.DEPRECATION_DURATION_MONTHS} months from now`
      );
    }

    this.registry[config.endpoint] = config;

    logWarning(`Endpoint deprecated: ${config.endpoint}`, {
      sunsetDate: config.sunsetDate.toISOString(),
      replacementEndpoint: config.replacementEndpoint,
      reason: config.reason,
    });
  }

  /**
   * Get deprecation config for an endpoint
   */
  getDeprecation(endpoint: string): DeprecationConfig | undefined {
    return this.registry[endpoint];
  }

  /**
   * Check if an endpoint is deprecated
   */
  isDeprecated(endpoint: string): boolean {
    return endpoint in this.registry;
  }

  /**
   * Check if an endpoint should be removed (sunset date passed)
   */
  shouldBeRemoved(endpoint: string): boolean {
    const config = this.registry[endpoint];
    if (!config) return false;
    return new Date() > config.sunsetDate;
  }

  /**
   * Get all deprecated endpoints
   */
  getAllDeprecated(): DeprecationRegistry {
    return { ...this.registry };
  }

  /**
   * Get deprecation status for all endpoints
   */
  getDeprecationStatus(): Array<{
    endpoint: string;
    status: 'active' | 'deprecated' | 'sunset';
    daysUntilSunset?: number;
    replacementEndpoint?: string;
  }> {
    const now = new Date();
    return Object.entries(this.registry).map(([endpoint, config]) => {
      const daysUntilSunset = Math.ceil(
        (config.sunsetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      let status: 'active' | 'deprecated' | 'sunset' = 'deprecated';
      if (now > config.sunsetDate) {
        status = 'sunset';
      }

      return {
        endpoint,
        status,
        daysUntilSunset: status === 'sunset' ? undefined : daysUntilSunset,
        replacementEndpoint: config.replacementEndpoint,
      };
    });
  }

  /**
   * Remove a deprecated endpoint from registry
   */
  removeDeprecation(endpoint: string): void {
    delete this.registry[endpoint];
  }

  /**
   * Clear all deprecations
   */
  clearAll(): void {
    this.registry = {};
  }
}

// Singleton instance
const deprecationManager = new DeprecationManager();

/**
 * Middleware to add deprecation headers to responses
 */
export function deprecationHeadersMiddleware(endpoint: string) {
  return (res: Response, next: any) => {
    const deprecation = deprecationManager.getDeprecation(endpoint);

    if (deprecation) {
      // Add Deprecation header (RFC 8594)
      res.set('Deprecation', 'true');

      // Add Sunset header (RFC 8594)
      res.set('Sunset', deprecation.sunsetDate.toUTCString());

      // Add Link header with migration info
      if (deprecation.replacementEndpoint) {
        res.set(
          'Link',
          `<${deprecation.replacementEndpoint}>; rel="successor-version"`
        );
      }

      // Add custom header with migration guide URL
      if (deprecation.migrationGuide) {
        res.set('X-API-Migration-Guide', deprecation.migrationGuide);
      }

      // Add warning header
      const warningMessage = `API endpoint deprecated. Sunset date: ${deprecation.sunsetDate.toISOString()}`;
      res.set('Warning', `299 - "${warningMessage}"`);

      // Log the deprecation usage
      addBreadcrumb(`Deprecated endpoint accessed: ${endpoint}`, 'deprecation', {
        replacementEndpoint: deprecation.replacementEndpoint,
        sunsetDate: deprecation.sunsetDate.toISOString(),
      });
    }

    next();
  };
}

/**
 * Middleware to block sunset endpoints
 */
export function sunsetBlockerMiddleware(endpoint: string) {
  return (req: any, res: Response, next: any) => {
    if (deprecationManager.shouldBeRemoved(endpoint)) {
      const deprecation = deprecationManager.getDeprecation(endpoint);

      res.status(410).json({
        error: 'Gone',
        message: `This API endpoint has been removed as of ${deprecation?.sunsetDate.toISOString()}`,
        replacementEndpoint: deprecation?.replacementEndpoint,
        migrationGuide: deprecation?.migrationGuide,
      });

      addBreadcrumb(`Sunset endpoint accessed: ${endpoint}`, 'deprecation', {
        replacementEndpoint: deprecation?.replacementEndpoint,
      });

      return;
    }

    next();
  };
}

/**
 * Decorator for deprecating route handlers
 */
export function deprecated(config: Omit<DeprecationConfig, 'endpoint'>) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const req = args[0];
      const res = args[1];

      const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
      const deprecation = deprecationManager.getDeprecation(endpoint);

      if (deprecation) {
        // Add deprecation headers
        res.set('Deprecation', 'true');
        res.set('Sunset', deprecation.sunsetDate.toUTCString());

        if (deprecation.replacementEndpoint) {
          res.set(
            'Link',
            `<${deprecation.replacementEndpoint}>; rel="successor-version"`
          );
        }

        if (deprecation.migrationGuide) {
          res.set('X-API-Migration-Guide', deprecation.migrationGuide);
        }
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Helper to create deprecation config with default 6-month window
 */
export function createDeprecationConfig(
  endpoint: string,
  options: {
    replacementEndpoint?: string;
    migrationGuide?: string;
    reason?: string;
    sunsetMonths?: number;
  } = {}
): DeprecationConfig {
  const deprecatedDate = new Date();
  const sunsetDate = new Date();
  sunsetDate.setMonth(
    sunsetDate.getMonth() + (options.sunsetMonths || 6)
  );

  return {
    endpoint,
    deprecatedDate,
    sunsetDate,
    replacementEndpoint: options.replacementEndpoint,
    migrationGuide: options.migrationGuide,
    reason: options.reason,
  };
}

export default deprecationManager;
