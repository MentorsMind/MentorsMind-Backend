import { env } from './env';

const elasticsearchConfig = {
  url: env.ELASTICSEARCH_URL,
  username: env.ELASTICSEARCH_USERNAME,
  password: env.ELASTICSEARCH_PASSWORD,
  apiKey: env.ELASTICSEARCH_API_KEY,
  enabled: env.ELASTICSEARCH_ENABLED === 'true',
  indexPrefix: env.ELASTICSEARCH_INDEX_PREFIX,
  
  // Index names
  indices: {
    mentors: `${env.ELASTICSEARCH_INDEX_PREFIX}-mentors`,
    sessions: `${env.ELASTICSEARCH_INDEX_PREFIX}-sessions`,
    content: `${env.ELASTICSEARCH_INDEX_PREFIX}-content`,
  },
  
  // Search settings
  search: {
    defaultPageSize: 10,
    maxPageSize: 100,
    fuzzyDistance: 2,
    minShouldMatch: '75%',
  },
} as const;

export default elasticsearchConfig;
export type ElasticsearchConfig = typeof elasticsearchConfig;
