import { env } from './env';

export const graphqlConfig = {
  path: '/api/graphql',
  maxComplexity: Number(process.env.GRAPHQL_MAX_COMPLEXITY ?? 100),
  introspection: env.NODE_ENV !== 'production',
  playground: env.NODE_ENV !== 'production',
};
