/**
 * Entity reference resolvers (issue #866).
 *
 * When one subgraph returns `{ __typename: "User", id }`, the gateway must ask
 * the owning subgraph to turn that reference into a full object. These are
 * those resolvers.
 *
 * References are batched per type: resolving them one at a time is the
 * federation equivalent of an N+1 query, and it is the usual reason a federated
 * graph is slower than the monolith it replaced.
 */

import { logger } from "../../utils/logger";

export interface EntityReference {
  __typename: string;
  [key: string]: unknown;
}

export type EntityBatchLoader = (
  references: EntityReference[],
) => Promise<Array<Record<string, unknown> | null>>;

const loaders = new Map<string, EntityBatchLoader>();

/** Register the batch loader that owns a type. */
export function registerEntityLoader(typeName: string, loader: EntityBatchLoader): void {
  loaders.set(typeName, loader);
}

export function clearEntityLoaders(): void {
  loaders.clear();
}

/**
 * Resolve `_entities` references.
 *
 * Groups by `__typename`, calls each owning loader once, then reassembles in
 * the original order — federation requires the returned array to align
 * positionally with the input.
 */
export async function resolveEntities(
  references: EntityReference[],
): Promise<Array<Record<string, unknown> | null>> {
  const byType = new Map<string, Array<{ index: number; ref: EntityReference }>>();

  references.forEach((ref, index) => {
    const group = byType.get(ref.__typename) ?? [];
    group.push({ index, ref });
    byType.set(ref.__typename, group);
  });

  const resolved: Array<Record<string, unknown> | null> = new Array(references.length).fill(null);

  await Promise.all(
    [...byType.entries()].map(async ([typeName, group]) => {
      const loader = loaders.get(typeName);
      if (!loader) {
        logger.warn({ typeName }, "No entity loader registered; returning null references");
        return;
      }

      try {
        const results = await loader(group.map((g) => g.ref));
        group.forEach((entry, i) => {
          resolved[entry.index] = results[i] ?? null;
        });
      } catch (error) {
        // A failing loader nulls its own entities rather than failing the whole
        // query — partial data is the documented GraphQL behaviour here.
        logger.error(
          {
            typeName,
            error: error instanceof Error ? error.message : String(error),
          },
          "Entity loader failed",
        );
      }
    }),
  );

  return resolved;
}

export const federatedEntityResolvers = {
  Query: {
    _entities: (_: unknown, args: { representations: EntityReference[] }) =>
      resolveEntities(args.representations ?? []),
    _service: () => ({ sdl: "" }),
  },
};

export default federatedEntityResolvers;
