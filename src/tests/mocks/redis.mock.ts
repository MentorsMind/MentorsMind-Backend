/**
 * Redis Mock Factory
 * Provides mock implementations for Redis operations
 */

export interface MockRedisClient {
    get: jest.MockedFunction<any>;
    set: jest.MockedFunction<any>;
    del: jest.MockedFunction<any>;
    exists: jest.MockedFunction<any>;
    expire: jest.MockedFunction<any>;
    ttl: jest.MockedFunction<any>;
    keys: jest.MockedFunction<any>;
    hget: jest.MockedFunction<any>;
    hset: jest.MockedFunction<any>;
    hdel: jest.MockedFunction<any>;
    hgetall: jest.MockedFunction<any>;
    lpush: jest.MockedFunction<any>;
    rpush: jest.MockedFunction<any>;
    lpop: jest.MockedFunction<any>;
    rpop: jest.MockedFunction<any>;
    lrange: jest.MockedFunction<any>;
    llen: jest.MockedFunction<any>;
    sadd: jest.MockedFunction<any>;
    srem: jest.MockedFunction<any>;
    smembers: jest.MockedFunction<any>;
    sismember: jest.MockedFunction<any>;
    zadd: jest.MockedFunction<any>;
    zrem: jest.MockedFunction<any>;
    zrange: jest.MockedFunction<any>;
    zrangebyscore: jest.MockedFunction<any>;
    incr: jest.MockedFunction<any>;
    decr: jest.MockedFunction<any>;
    flushall: jest.MockedFunction<any>;
    quit: jest.MockedFunction<any>;
    disconnect: jest.MockedFunction<any>;
    on: jest.MockedFunction<any>;
    connect: jest.MockedFunction<any>;
}

/**
 * Create a mock Redis client
 */
export function createMockRedisClient(): MockRedisClient {
    return {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        exists: jest.fn(),
        expire: jest.fn(),
        ttl: jest.fn(),
        keys: jest.fn(),
        hget: jest.fn(),
        hset: jest.fn(),
        hdel: jest.fn(),
        hgetall: jest.fn(),
        lpush: jest.fn(),
        rpush: jest.fn(),
        lpop: jest.fn(),
        rpop: jest.fn(),
        lrange: jest.fn(),
        llen: jest.fn(),
        sadd: jest.fn(),
        srem: jest.fn(),
        smembers: jest.fn(),
        sismember: jest.fn(),
        zadd: jest.fn(),
        zrem: jest.fn(),
        zrange: jest.fn(),
        zrangebyscore: jest.fn(),
        incr: jest.fn(),
        decr: jest.fn(),
        flushall: jest.fn(),
        quit: jest.fn(),
        disconnect: jest.fn(),
        on: jest.fn(),
        connect: jest.fn(),
    };
}

/**
 * Mock Redis module
 */
export function mockRedisModule() {
    const mockClient = createMockRedisClient();

    jest.mock('ioredis', () => {
        return jest.fn().mockImplementation(() => mockClient);
    });

    return mockClient;
}

/**
 * Setup common Redis mock responses
 */
export function setupRedisMocks(mockClient: MockRedisClient) {
    // Default successful responses
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockResolvedValue('OK');
    mockClient.del.mockResolvedValue(1);
    mockClient.exists.mockResolvedValue(0);
    mockClient.expire.mockResolvedValue(1);
    mockClient.ttl.mockResolvedValue(-1);
    mockClient.keys.mockResolvedValue([]);
    mockClient.hget.mockResolvedValue(null);
    mockClient.hset.mockResolvedValue(1);
    mockClient.hdel.mockResolvedValue(1);
    mockClient.hgetall.mockResolvedValue({});
    mockClient.lpush.mockResolvedValue(1);
    mockClient.rpush.mockResolvedValue(1);
    mockClient.lpop.mockResolvedValue(null);
    mockClient.rpop.mockResolvedValue(null);
    mockClient.lrange.mockResolvedValue([]);
    mockClient.llen.mockResolvedValue(0);
    mockClient.sadd.mockResolvedValue(1);
    mockClient.srem.mockResolvedValue(1);
    mockClient.smembers.mockResolvedValue([]);
    mockClient.sismember.mockResolvedValue(0);
    mockClient.zadd.mockResolvedValue(1);
    mockClient.zrem.mockResolvedValue(1);
    mockClient.zrange.mockResolvedValue([]);
    mockClient.zrangebyscore.mockResolvedValue([]);
    mockClient.incr.mockResolvedValue(1);
    mockClient.decr.mockResolvedValue(0);
    mockClient.flushall.mockResolvedValue('OK');
    mockClient.quit.mockResolvedValue('OK');
    mockClient.disconnect.mockReturnValue(undefined);
    mockClient.connect.mockResolvedValue(undefined);

    return mockClient;
}

/**
 * Create a mock cache service
 */
export function createMockCacheService() {
    const mockClient = createMockRedisClient();

    return {
        client: mockClient,
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        exists: jest.fn(),
        flush: jest.fn(),
        getOrSet: jest.fn(),
    };
}
