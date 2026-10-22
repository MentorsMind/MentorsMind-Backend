import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import {
  ApolloServerPluginLandingPageLocalDefault,
  ApolloServerPluginLandingPageProductionDefault,
} from '@apollo/server/plugin/landingPage/default';
import { Application, json } from 'express';
import jwt from 'jsonwebtoken';
import { GraphQLError, ValidationContext, FieldNode, Kind } from 'graphql';
import typeDefs from './schema';
import resolvers from './resolvers';
import { graphqlConfig } from '../config/graphql';
import { createLoaders } from './dataloaders';
import { env } from '../config/env';
import { TenantContext } from '../utils/tenant-context.utils';

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

const createQueryDepthRule = (maxDepth: number) => {
  return (context: ValidationContext) => {
    function fieldDepth(node: FieldNode, depth: number): number {
      const selectionSet = node.selectionSet;
      if (!selectionSet) return depth;

      let maxChildDepth = depth;
      for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
          maxChildDepth = Math.max(maxChildDepth, fieldDepth(selection, depth + 1));
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          for (const inner of selection.selectionSet.selections) {
            if (inner.kind === Kind.FIELD) {
              maxChildDepth = Math.max(maxChildDepth, fieldDepth(inner, depth + 1));
            }
          }
        }
      }
      return maxChildDepth;
    }

    return {
      OperationDefinition: (node: any) => {
        let depth = 0;
        for (const selection of node.selectionSet.selections) {
          if (selection.kind === Kind.FIELD) {
            depth = Math.max(depth, fieldDepth(selection, 1));
          }
        }
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(`GraphQL query depth ${depth} exceeds maximum allowed depth of ${maxDepth}.`),
          );
        }
      },
    };
  };
};

export async function initializeGraphQL(app: Application): Promise<void> {
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
      createQueryDepthRule(graphqlConfig.maxDepth),
    ],
  });

  await server.start();

  /**
   * Mounts the GraphQL endpoint (POST /api/graphql by default).
   *
   * Apollo Server's `expressMiddleware` registers the route here rather than
   * in `src/app.ts`, so the Swagger/OpenAPI documentation entry for this
   * endpoint (tags, bearer auth, request body) is declared as a `@swagger`
   * annotation in `src/app.ts` and picked up via `swaggerOptions.apis`.
   *
   * No functional change: same path, JSON body parser, and auth context.
   */
  app.use(
    graphqlConfig.path,
    json(),
    expressMiddleware(server as any, {
      context: async ({ req, res }) => {
        const payload = getUserFromAuthorizationHeader(req.headers.authorization);

        // Extract tenant ID from the tenant middleware (req.tenant) or the
        // x-tenant-id header as a fallback. Casting through `any` avoids a
        // dependency on the tenantMiddleware type augmentation from here.
        const tenantId: string | null =
          (req as any).tenant?.id ??
          (req.headers['x-tenant-id'] as string | undefined) ??
          null;

        // Build the context object inside a TenantContext.run() scope so that
        // every resolver executing within this request inherits the correct
        // AsyncLocalStorage tenant context and TenantContext.getTenantId()
        // returns the right value without cross-tenant leakage.
        return TenantContext.run(tenantId, () => ({
          req,
          res,
          tenantId,
          user: payload ? { userId: payload.sub, role: payload.role } : undefined,
          // Keep loaders request-scoped so their caches cannot cross request or tenant boundaries.
          // Their batch functions use shared, module-level database and Redis clients.
          loaders: createLoaders(),
        }));
      },
    }) as any,
  );
}
