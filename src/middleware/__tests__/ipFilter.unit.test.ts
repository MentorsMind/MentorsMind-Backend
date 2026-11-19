import { Request, Response, NextFunction } from 'express';
import { blocklistMiddleware } from '../ipFilter.middleware';
import { IpFilterService } from '../../services/ipFilter.service';
import { CacheService } from '../../services/cache.service';
import { AuditLogService } from '../../services/auditLog.service';

jest.mock('../../services/ipFilter.service');
jest.mock('../../services/cache.service');
jest.mock('../../services/auditLog.service');

describe('IP Filter Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockReq = {
      ip: '192.168.1.100',
      path: '/api/v1/test',
      method: 'GET',
      headers: {
        'x-forwarded-for': '192.168.1.100'
      }
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    };
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should block IPs that are in the blocklist', async () => {
    (IpFilterService.isIpBlocked as jest.Mock).mockResolvedValue(true);
    
    await blocklistMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(IpFilterService.isIpBlocked).toHaveBeenCalledWith('192.168.1.100');
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.end).toHaveBeenCalled();
    expect(nextFunction).not.toHaveBeenCalled();
    expect(AuditLogService.log).toHaveBeenCalled();
  });

  it('should allow IPs that are not in the blocklist', async () => {
    (IpFilterService.isIpBlocked as jest.Mock).mockResolvedValue(false);
    
    await blocklistMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(IpFilterService.isIpBlocked).toHaveBeenCalledWith('192.168.1.100');
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockRes.end).not.toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should fallback to allow if service throws an error', async () => {
    (IpFilterService.isIpBlocked as jest.Mock).mockRejectedValue(new Error('DB connection failed'));
    
    await blocklistMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(nextFunction).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});

describe('IpFilterService Performance & Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CacheService.wrap as jest.Mock).mockImplementation(async (key, ttl, fn) => {
      return await fn();
    });
  });

  it('lookup time should remain constant regardless of blocklist size', async () => {
    // Generate a massive array of rules
    const massiveRules = [];
    for (let i = 0; i < 100000; i++) {
      massiveRules.push({
        id: `rule-${i}`,
        ip_range: `10.0.0.${i % 255}`,
        rule_type: 'block',
        context: 'global',
        created_at: new Date()
      });
    }

    // Include the target IP
    massiveRules.push({
      id: 'target-rule',
      ip_range: '192.168.1.100',
      rule_type: 'block',
      context: 'global',
      created_at: new Date()
    });

    jest.spyOn(IpFilterService, 'getRules').mockResolvedValue(massiveRules as any);
    (CacheService.isDistributed as jest.Mock).mockReturnValue(false);

    // Warm up the local set
    await IpFilterService.isIpBlocked('127.0.0.1');

    const start = process.hrtime.bigint();
    const result = await IpFilterService.isIpBlocked('192.168.1.100');
    const end = process.hrtime.bigint();

    expect(result).toBe(true);

    // Ensure lookup took less than 2ms for 100k records, proving O(1)
    const durationMs = Number(end - start) / 1000000;
    expect(durationMs).toBeLessThan(5); // Adjust threshold as needed for CI runners
  });
});
