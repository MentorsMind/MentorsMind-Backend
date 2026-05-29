import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import {
  ApolloServerPluginLandingPageLocalDefault,
  ApolloServerPluginLandingPageProductionDefault,
} from '@apollo/server/plugin/landingPage/default';
import { Express, json } from 'express';
import jwt from 'jsonwebtoken';
import { GraphQLError, ValidationContext } from 'graphql';
import typeDefs from './schema';
import resolvers from './resolvers';
import { graphqlConfig } from '../config/graphql';
import { createLoaders } from './dataloaders';
import { env } from '../config/env';

interface TokenPayload {
  sub: string;
  role: string;
}

const getUserFromAuthorizationHeader = (authorization?: string) => {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.replace('Bearer ', '');

  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
};

const createQueryComplexityRule = (maximumComplexity: number) => {
  return (context: ValidationContext) => {
    let complexity = 0;

    return {
      Field: () => {
        complexity += 1;
      },
      Document: {
        leave: () => {
          if (complexity > maximumComplexity) {
            context.reportError(
              new GraphQLError(`GraphQL query is too complex: ${complexity}. Maximum allowed complexity: ${maximumComplexity}.`),
            );
          }
        },
      },
    };
  };
};

export async function initializeGraphQL(app: Express): Promise<void> {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    introspection: graphqlConfig.introspection,
    plugins: [
      graphqlConfig.playground
        ? ApolloServerPluginLandingPageLocalDefault({ embed: true })
        : ApolloServerPluginLandingPageProductionDefault(),
    ],
    validationRules: [
      createQueryComplexityRule(graphqlConfig.maxComplexity),
    ],
  });

  await server.start();

  app.use(
    graphqlConfig.path,
    json(),
    expressMiddleware(server, {
      context: async ({ req }) => {
        const payload = getUserFromAuthorizationHeader(req.headers.authorization);
        return {
          req,
          user: payload ? { userId: payload.sub, role: payload.role } : undefined,
          loaders: createLoaders(),
        };
      },
    }),
  );
}
