/**
 * GraphQL federation entry point (issue #866).
 *
 * Re-exports the federation surface so callers import from one place while the
 * implementation is split by concern.
 */

export * from "./directives";
export * from "./subscriptions";
export { default as SchemaCompositorService } from "../../services/schema-compositor.service";
export { default as FederatedGatewayService } from "../../services/federated-gateway.service";
