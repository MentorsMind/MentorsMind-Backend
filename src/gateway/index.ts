/**
 * API Gateway — public surface
 *
 * The gateway implements the API Gateway pattern for service-to-service and
 * north-south traffic: request routing by path prefix, per-client token-bucket
 * rate limiting, load balancing across upstream instances (round-robin,
 * weighted, least-connections, random), active health checking, per-service
 * circuit breaking, and a runtime service-discovery registry.
 *
 * It is opt-in: nothing runs unless `GATEWAY_ENABLED=true`. See
 * `gateway.config.ts` for all tunables.
 *
 * Typical wiring in `app.ts`:
 *   import { getApiGateway, gatewayRoutes } from "./gateway";
 *   app.use("/api/v1/gateway", gatewayRoutes);
 *   app.use(getApiGateway().middleware());
 *   getApiGateway().start();
 */

export { ApiGateway, getApiGateway, __resetApiGateway } from "./api-gateway";
export {
  ServiceRegistry,
  getServiceRegistry,
  __resetServiceRegistry,
} from "./service-registry";
export { RequestRouter } from "./request-router";
export { TokenBucketRateLimiter } from "./rate-limiter";
export { CircuitBreaker } from "./circuit-breaker";
export { selectInstance, eligibleInstances } from "./load-balancer";
export { default as gatewayConfig } from "./gateway.config";
export { default as gatewayRoutes } from "./gateway.routes";
export * from "./types";
