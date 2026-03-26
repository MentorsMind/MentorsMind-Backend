import { redactSensitiveFields } from '../logger';
import winston from 'winston';
import Transport from 'winston-transport';

// ---------------------------------------------------------------------------
// NODE_ENV=test suppresses the console transport in logger.ts.
// resetModules:true in jest.unit.config.ts ensures each require() is fresh.
// ---------------------------------------------------------------------------

describe('logger', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    jest.resetModules();
  });

  // -------------------------------------------------------------------------
  // Log level filtering
  // -------------------------------------------------------------------------
  describe('log level filtering', () => {
    it('defaults to "info" level', () => {
      delete process.env.LOG_LEVEL;
      const { logger } = require('../logger');
      expect(logger.level).toBe('info');
    });

    it('respects LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug';
      const { logger } = require('../logger');
      expect(logger.level).toBe('debug');
    });

    it('respects LOG_LEVEL=warn', () => {
      process.env.LOG_LEVEL = 'warn';
      const { logger } = require('../logger');
      expect(logger.level).toBe('warn');
    });
  });

  // -------------------------------------------------------------------------
  // Sensitive field redaction — tested directly on the exported helper
  // -------------------------------------------------------------------------
  describe('redactSensitiveFields', () => {
    it('redacts "password" key', () => {
      const input = { username: 'alice', password: 'super-secret' };
      const result = redactSensitiveFields(input) as any;
      expect(result.password).toBe('[REDACTED]');
      expect(result.username).toBe('alice');
    });

    it('redacts "token" key', () => {
      const result = redactSensitiveFields({ token: 'jwt-secret' }) as any;
      expect(result.token).toBe('[REDACTED]');
    });

    it('redacts "secret" key recursively nested in an object', () => {
      const result = redactSensitiveFields({ config: { secret: 'my-secret', name: 'test' } }) as any;
      expect(result.config.secret).toBe('[REDACTED]');
      expect(result.config.name).toBe('test');
    });

    it('redacts "apiKey" and "privateKey"', () => {
      const result = redactSensitiveFields({ apiKey: 'key-123', privateKey: 'pk-456' }) as any;
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.privateKey).toBe('[REDACTED]');
    });

    it('does not redact non-sensitive fields', () => {
      const result = redactSensitiveFields({ method: 'POST', url: '/api/v1/auth' }) as any;
      expect(result.method).toBe('POST');
      expect(result.url).toBe('/api/v1/auth');
    });

    it('handles null and primitives safely', () => {
      expect(redactSensitiveFields(null)).toBeNull();
      expect(redactSensitiveFields(42)).toBe(42);
      expect(redactSensitiveFields('string')).toBe('string');
    });

    it('handles arrays containing objects with sensitive keys', () => {
      const result = redactSensitiveFields([{ password: 'p1' }, { name: 'bob' }]) as any[];
      expect(result[0].password).toBe('[REDACTED]');
      expect(result[1].name).toBe('bob');
    });
  });

  // -------------------------------------------------------------------------
  // withCorrelationId — integration test via spy transport
  // -------------------------------------------------------------------------
  describe('withCorrelationId', () => {
    it('injects correlationId into every log entry from child logger', () => {
      process.env.NODE_ENV = 'test';
      process.env.LOG_LEVEL = 'debug';
      jest.resetModules();

      const written: any[] = [];
      class SpyTransport extends Transport {
        log(info: any, callback: () => void) {
          written.push({ ...info });
          callback();
        }
      }

      const { logger, withCorrelationId } = require('../logger') as {
        logger: winston.Logger;
        withCorrelationId: (id: string) => winston.Logger;
      };

      const spy = new SpyTransport({ format: winston.format.json() });
      logger.add(spy as any);

      const child = withCorrelationId('corr-xyz-789');
      child.info('hello from child');

      const entry = written[written.length - 1];
      expect(entry.correlationId).toBe('corr-xyz-789');
      logger.remove(spy as any);
    });
  });
});
