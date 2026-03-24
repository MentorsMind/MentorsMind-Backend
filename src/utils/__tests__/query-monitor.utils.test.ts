import { PoolClient } from 'pg';
import { QueryMonitor } from '../query-monitor.utils';


jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
  }));
});

describe('QueryMonitor', () => {
  let mockClient: jest.Mocked<PoolClient>;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
    } as unknown as jest.Mocked<PoolClient>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should execute query successfully without cache', async () => {
    const mockResult = { rows: [{ id: 1 }], command: 'SELECT', rowCount: 1, oid: 0, fields: [] };
    (mockClient.query as jest.Mock).mockResolvedValueOnce(mockResult);

    const result = await QueryMonitor.execute(mockClient, 'SELECT * FROM users');
    
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM users', undefined);
  });

  it('should set statement_timeout when timeoutMs is provided', async () => {
    const mockResult = { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
    (mockClient.query as jest.Mock)
      .mockResolvedValueOnce({}) // SET statement_timeout
      .mockResolvedValueOnce(mockResult); // actual query

    await QueryMonitor.execute(mockClient, 'SELECT * FROM users', [], { timeoutMs: 2000 });
    
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'SET LOCAL statement_timeout = 2000');
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'SELECT * FROM users', []);
  });

  it('should warn about slow queries and execute explain plan', async () => {
    // Mock hrtime to simulate slow query
    const hrtimeSpy = jest.spyOn(process, 'hrtime')
      .mockReturnValueOnce([0, 0])
      .mockReturnValueOnce([1, 0]); // 1 second duration
    
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    (mockClient.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] }) // main query
      .mockResolvedValueOnce({ rows: [{ plan: 'sequential scan' }] }); // explain query

    await QueryMonitor.execute(mockClient, 'SELECT * FROM slow_table');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[SLOW QUERY]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[QUERY EXPLAIN PLAN]'), expect.any(String));

    hrtimeSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
