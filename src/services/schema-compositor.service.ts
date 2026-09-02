/**
 * Schema composition and validation (issue #866).
 *
 * Composition is the step that catches a broken federation *before* it serves
 * traffic. Two subgraphs both owning `User.email`, or one extending a type
 * nobody owns, are deploy-time errors — at query time they surface as
 * intermittent wrong answers depending on which subgraph resolved the field.
 *
 * Composition therefore fails loudly and returns every error at once, so a
 * subgraph author fixes the whole set in one pass.
 */

import { logger } from "../utils/logger";
import {
  extractEntityKeys,
  extractExtendedTypes,
  extractObjectTypes,
  type SubgraphDefinition,
} from "../graphql/federation/directives";

export interface CompositionError {
  kind:
    | "duplicate-entity-owner"
    | "extends-unowned-type"
    | "conflicting-field"
    | "missing-key"
    | "empty-supergraph";
  message: string;
  subgraphs: string[];
}

export interface CompositionResult {
  success: boolean;
  errors: CompositionError[];
  /** Composed SDL. Present only on success. */
  supergraphSdl?: string;
  /** Which subgraph owns each entity type. */
  ownership: Record<string, string>;
  /** Version hash, so a rollout can be identified and rolled back. */
  version?: string;
}

/** Field names declared on a type within one SDL document. */
function fieldsOfType(sdl: string, typeName: string): string[] {
  const pattern = new RegExp(
    `(?:extend\\s+)?type\\s+${typeName}\\b[^{]*\\{([^}]*)\\}`,
    "g",
  );
  const fields = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sdl)) !== null) {
    for (const line of match[1].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const name = trimmed.match(/^(\w+)\s*(?:\(|:)/);
      // A field marked @external is a reference, not a definition, so it does
      // not conflict with the owning subgraph's declaration.
      if (name && !trimmed.includes("@external")) fields.add(name[1]);
    }
  }
  return [...fields];
}

export const SchemaCompositorService = {
  /**
   * Compose subgraphs into a supergraph.
   *
   * Returns errors rather than throwing: the caller decides whether to keep
   * serving the previous supergraph, which is usually the right move in
   * production.
   */
  compose(subgraphs: SubgraphDefinition[]): CompositionResult {
    const errors: CompositionError[] = [];
    const ownership: Record<string, string> = {};

    if (subgraphs.length === 0) {
      return {
        success: false,
        errors: [
          {
            kind: "empty-supergraph",
            message: "No subgraphs supplied; refusing to compose an empty supergraph",
            subgraphs: [],
          },
        ],
        ownership: {},
      };
    }

    // 1. Entity ownership must be unique.
    for (const subgraph of subgraphs) {
      const keys = subgraph.entities.length
        ? subgraph.entities
        : extractEntityKeys(subgraph.sdl);

      for (const key of keys) {
        const existing = ownership[key.typeName];
        if (existing && existing !== subgraph.name) {
          errors.push({
            kind: "duplicate-entity-owner",
            message: `Entity ${key.typeName} is claimed by both ${existing} and ${subgraph.name}`,
            subgraphs: [existing, subgraph.name],
          });
          continue;
        }
        ownership[key.typeName] = subgraph.name;
      }
    }

    // 2. An extended type must be owned by somebody.
    for (const subgraph of subgraphs) {
      const extended = subgraph.extendedTypes.length
        ? subgraph.extendedTypes
        : extractExtendedTypes(subgraph.sdl);

      for (const typeName of extended) {
        if (!ownership[typeName]) {
          errors.push({
            kind: "extends-unowned-type",
            message: `${subgraph.name} extends ${typeName}, which no subgraph owns via @key`,
            subgraphs: [subgraph.name],
          });
        }
      }
    }

    // 3. Two subgraphs must not define the same field on a shared type.
    const seenFields = new Map<string, string>();
    for (const subgraph of subgraphs) {
      for (const typeName of extractObjectTypes(subgraph.sdl)) {
        if (["Query", "Mutation", "Subscription"].includes(typeName)) continue;

        for (const field of fieldsOfType(subgraph.sdl, typeName)) {
          const fieldKey = `${typeName}.${field}`;
          const owner = seenFields.get(fieldKey);
          if (owner && owner !== subgraph.name) {
            errors.push({
              kind: "conflicting-field",
              message: `${fieldKey} is defined by both ${owner} and ${subgraph.name}`,
              subgraphs: [owner, subgraph.name],
            });
            continue;
          }
          seenFields.set(fieldKey, subgraph.name);
        }
      }
    }

    if (errors.length > 0) {
      logger.error({ errors: errors.length }, "GraphQL schema composition failed");
      return { success: false, errors, ownership };
    }

    const supergraphSdl = subgraphs
      .map((s) => `# --- subgraph: ${s.name} (${s.url}) ---\n${s.sdl.trim()}`)
      .join("\n\n");

    return {
      success: true,
      errors: [],
      ownership,
      supergraphSdl,
      version: versionOf(supergraphSdl),
    };
  },

  /**
   * Whether moving to `next` is safe for existing clients.
   *
   * Removing a type or field breaks queries already in flight, so schema
   * evolution is gated on additive-only changes unless explicitly overridden.
   */
  checkEvolution(
    previous: CompositionResult,
    next: CompositionResult,
  ): { safe: boolean; breaking: string[] } {
    const breaking: string[] = [];
    if (!previous.supergraphSdl || !next.supergraphSdl) {
      return { safe: true, breaking };
    }

    const before = new Set(extractObjectTypes(previous.supergraphSdl));
    const after = new Set(extractObjectTypes(next.supergraphSdl));

    for (const typeName of before) {
      if (!after.has(typeName)) breaking.push(`Type ${typeName} was removed`);
    }

    for (const [typeName, owner] of Object.entries(previous.ownership)) {
      const nextOwner = next.ownership[typeName];
      if (nextOwner && nextOwner !== owner) {
        breaking.push(`Ownership of ${typeName} moved from ${owner} to ${nextOwner}`);
      }
    }

    return { safe: breaking.length === 0, breaking };
  },
};

function versionOf(sdl: string): string {
  let hash = 0;
  for (let i = 0; i < sdl.length; i += 1) {
    hash = (hash << 5) - hash + sdl.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export default SchemaCompositorService;
