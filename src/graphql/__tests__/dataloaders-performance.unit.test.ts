import { expressMiddleware } from "@apollo/server/express4";
import { initializeGraphQL } from "../server";
import { UsersService } from "../../services/users.service";

jest.mock("@apollo/server", () => ({
  ApolloServer: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock("@apollo/server/express4", () => ({
  expressMiddleware: jest.fn().mockReturnValue(jest.fn()),
}));
jest.mock("@apollo/server/plugin/landingPage/default", () => ({
  ApolloServerPluginLandingPageLocalDefault: jest.fn().mockReturnValue({}),
  ApolloServerPluginLandingPageProductionDefault: jest.fn().mockReturnValue({}),
}));
jest.mock("../../graphql/schema", () => "type Query { _: Boolean }");
jest.mock("../../graphql/resolvers", () => ({}));
jest.mock("../../config/graphql", () => ({
  graphqlConfig: {
    path: "/api/graphql",
    introspection: true,
    playground: true,
    maxComplexity: 100,
    maxDepth: 10,
  },
}));
jest.mock("../../config/env", () => ({
  env: { JWT_SECRET: "test-secret" },
}));
jest.mock("../../services/users.service", () => ({
  UsersService: {
    findPublicByIds: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock("../../services/mentors.service", () => ({
  MentorsService: {
    findByIds: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock("../../models/booking.model", () => ({
  BookingModel: { findByUserIds: jest.fn().mockResolvedValue([]) },
}));
jest.mock("../../models/payment.model", () => ({
  PaymentModel: { findByUserIds: jest.fn().mockResolvedValue([]) },
}));
jest.mock("../../models/review.model", () => ({
  ReviewModel: { findByUserIds: jest.fn().mockResolvedValue([]) },
}));
jest.mock("../../models/wallet.model", () => ({
  WalletModel: { findByUserIds: jest.fn().mockResolvedValue([]) },
}));
jest.mock("ioredis", () => {
  const instances: unknown[] = [];
  const MockRedis = jest.fn().mockImplementation(() => {
    const client = {};
    instances.push(client);
    return client;
  });

  return {
    __esModule: true,
    default: MockRedis,
    Cluster: MockRedis,
    __mockInstances: instances,
  };
});

describe("GraphQL DataLoader resource lifecycle", () => {
  it("creates fresh request loaders without opening Redis clients and batches loads per request", async () => {
    const app = { use: jest.fn() };
    const redisInstances = (
      jest.requireMock("ioredis") as {
        __mockInstances: unknown[];
      }
    ).__mockInstances;

    await initializeGraphQL(app as any);
    const redisCountBeforeRequests = redisInstances.length;

    const context = jest.mocked(expressMiddleware).mock.calls[0][1].context as (
      args: any,
    ) => Promise<{
      loaders: { userLoader: { load: (id: string) => Promise<unknown> } };
    }>;
    const firstRequest = await context({ req: { headers: {} }, res: {} });
    const secondRequest = await context({ req: { headers: {} }, res: {} });

    expect(firstRequest.loaders.userLoader).not.toBe(
      secondRequest.loaders.userLoader,
    );
    expect(redisInstances).toHaveLength(redisCountBeforeRequests);

    await Promise.all([
      firstRequest.loaders.userLoader.load("user-1"),
      firstRequest.loaders.userLoader.load("user-2"),
    ]);
    expect(UsersService.findPublicByIds).toHaveBeenCalledTimes(1);
  });
});
