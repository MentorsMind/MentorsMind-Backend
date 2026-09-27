jest.mock('@elastic/elasticsearch', () => ({
  Client: jest.fn().mockImplementation(() => ({ ping: jest.fn() })),
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    elasticsearch: {
      enabled: true,
      url: 'http://localhost:9200',
      requestTimeoutMs: 5000,
      search: { maxPageSize: 100 },
    },
  },
}));

import { Client } from '@elastic/elasticsearch';
import { ElasticsearchService } from '../elasticsearch.service';

describe('Elasticsearch request timeout', () => {
  it('configures a bounded request timeout on the client', () => {
    new ElasticsearchService();

    expect(Client).toHaveBeenCalledWith(expect.objectContaining({ requestTimeout: 5000 }));
  });
});
