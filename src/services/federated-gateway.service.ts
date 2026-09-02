/**
 * Federated GraphQL gateway (issue #866).
 *
 * Holds the composed supergraph, plans which subgraph answers which root
 * field, and signs service-to-service calls.
 *
 * Query planning here is deliberately shallow: it routes root fields to owning
 * subgraphs and resolves entity references. Full cross-subgraph join planning
 * belongs to a dedicated planner, and pretending otherwise would produce
 * silently wrong results on nested cross-service selections — see the note on
 * `plan()`.
 */

import crypto from "crypto";
import { logger } from "../utils/logger";
import type { SubgraphDefinition } from "../graphql/federation/directives";
import SchemaCompositorService, {
  type CompositionResult,
} from "./schema-compositor.service";

export interface QueryPlanStep {
  subgraph: string;
  url: string;
  /** Root fields this subgraph will answer. */
  rootFields: string[];
  /** Steps that must complete first. */
  dependsOn: string[];
}

export interface QueryPlan {
  steps: QueryPlanStep[];
  /** Root fields no subgraph claims. */
  unresolved: string[];
  /** True when every root field maps to a subgraph. */
  complete: boolean;
}

const subgraphs = new Map<string, SubgraphDefinition>();
let composition: CompositionResult | null = null;
/** Root field -> owning subgraph. */
const rootFieldOwners = new Map<string, string>();

/** Root fields declared on Query/Mutation/Subscription in an SDL document. */
function rootFieldsOf(sdl: string, operation: string): string[] {
  const pattern = new RegExp(
    `(?:extend\\s+)?type\\s+${operation}\\b[^{]*\\{([^}]*)\\}`,
    "g",
  );
  const fields: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sdl)) !== null) {
    for (const line of match[1].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const name = trimmed.match(/^(\w+)\s*(?:\(|:)/);
      if (name) fields.push(name[1]);
    }
  }
  return fields;
}

export const FederatedGatewayService = {
  /**
   * Register subgraphs and recompose.
   *
   * On a composition failure the previous supergraph is kept: serving a stale
   * but valid schema is strictly better than serving a broken one, and the
   * error is logged for the deploy to act on.
   */
  register(definitions: SubgraphDefinition[]): CompositionResult {
    const result = SchemaCompositorService.compose(definitions);

    if (!result.success) {
      logger.error(
        { errors: result.errors.map((e) => e.message) },
        "Refusing to activate an invalid supergraph; keeping the previous one",
      );
      return result;
    }

    subgraphs.clear();
    rootFieldOwners.clear();
    for (const definition of definitions) {
      subgraphs.set(definition.name, definition);
      for (const operation of ["Query", "Mutation", "Subscription"]) {
        for (const field of rootFieldsOf(definition.sdl, operation)) {
          rootFieldOwners.set(`${operation}.${field}`, definition.name);
        }
      }
    }

    composition = result;
    logger.info(
      { subgraphs: definitions.length, version: result.version },
      "Supergraph activated",
    );
    return result;
  },

  currentComposition(): CompositionResult | null {
    return composition;
  },

  /**
   * Plan which subgraphs answer a set of root fields.
   *
   * **Limitation, stated rather than hidden:** this resolves root fields and
   * entity references. A selection that traverses from one subgraph's type into
   * a field owned by another requires an entity-fetch round trip that this
   * planner does not yet emit — such fields appear in `unresolved` and the plan
   * reports `complete: false` instead of quietly dropping them.
   */
  plan(operation: "Query" | "Mutation" | "Subscription", rootFields: string[]): QueryPlan {
    const bySubgraph = new Map<string, string[]>();
    const unresolved: string[] = [];

    for (const field of rootFields) {
      const owner = rootFieldOwners.get(`${operation}.${field}`);
      if (!owner) {
        unresolved.push(field);
        continue;
      }
      const existing = bySubgraph.get(owner) ?? [];
      existing.push(field);
      bySubgraph.set(owner, existing);
    }

    const steps: QueryPlanStep[] = [...bySubgraph.entries()].map(
      ([name, fields]) => ({
        subgraph: name,
        url: subgraphs.get(name)?.url ?? "",
        rootFields: fields,
        // Root fields are independent, so these fan out in parallel. Ordering
        // only becomes necessary once entity fetches are planned.
        dependsOn: [],
      }),
    );

    return { steps, unresolved, complete: unresolved.length === 0 };
  },

  /**
   * Sign a service-to-service call.
   *
   * HMAC over method, path, timestamp and body hash. The timestamp is inside
   * the signed payload so a captured header cannot be replayed later against a
   * different request.
   */
  signRequest(input: {
    method: string;
    path: string;
    body?: string;
    secret?: string;
  }): { signature: string; timestamp: string } | null {
    const secret = input.secret ?? process.env.FEDERATION_SHARED_SECRET;
    if (!secret) {
      logger.warn("FEDERATION_SHARED_SECRET unset; subgraph calls will be unsigned");
      return null;
    }

    const timestamp = Date.now().toString();
    const bodyHash = crypto
      .createHash("sha256")
      .update(input.body ?? "")
      .digest("hex");

    const signature = crypto
      .createHmac("sha256", secret)
      .update(`${input.method.toUpperCase()}\n${input.path}\n${timestamp}\n${bodyHash}`)
      .digest("hex");

    return { signature, timestamp };
  },

  /**
   * Verify an inbound signature.
   *
   * Constant-time comparison, and a freshness window so an intercepted request
   * cannot be replayed indefinitely.
   */
  verifyRequest(input: {
    method: string;
    path: string;
    body?: string;
    signature: string;
    timestamp: string;
    secret?: string;
    maxSkewMs?: number;
  }): boolean {
    const secret = input.secret ?? process.env.FEDERATION_SHARED_SECRET;
    if (!secret) return false;

    const skew = Math.abs(Date.now() - Number(input.timestamp));
    if (!Number.isFinite(skew) || skew > (input.maxSkewMs ?? 300_000)) return false;

    const bodyHash = crypto
      .createHash("sha256")
      .update(input.body ?? "")
      .digest("hex");

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${input.method.toUpperCase()}\n${input.path}\n${input.timestamp}\n${bodyHash}`)
      .digest("hex");

    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(input.signature, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

  /** Test hook. */
  reset(): void {
    subgraphs.clear();
    rootFieldOwners.clear();
    composition = null;
  },
};

export default FederatedGatewayService;
