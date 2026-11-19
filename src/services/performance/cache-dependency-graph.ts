/**
 * Cache dependency tracking (issue #864).
 *
 * Pattern-based invalidation (`del user:*`) is blunt: it either throws away far
 * more than it needs to, or misses derived entries that live under a different
 * namespace. A mentor profile change should invalidate that mentor's search
 * result pages and the category listings they appear in — none of which share
 * a key prefix with the profile.
 *
 * This models those relationships explicitly: a cache key declares what it was
 * built from, and invalidating a source walks the graph to find everything
 * downstream.
 *
 * Deliberately dependency-free — no redis, no logger, no config — so the graph
 * logic is unit-testable in isolation and can back either an in-memory or a
 * distributed store.
 */

/** A thing a cache entry can be derived from, e.g. `mentor:42`. */
export type DependencyNode = string;

export interface DependencyRegistration {
  /** The cache key being registered. */
  key: string;
  /** Entities this key's value was computed from. */
  dependsOn: DependencyNode[];
}

export interface GraphStats {
  trackedKeys: number;
  trackedNodes: number;
  /** Total edges — a rough measure of how tangled the cache is. */
  edges: number;
}

/**
 * Maximum depth walked when resolving transitive invalidations.
 *
 * A cycle (A derived from B, B derived from A) is a modelling mistake, but it
 * must not hang the request that trips over it. The visited-set already makes
 * termination guaranteed; this is a second belt against pathological fan-out.
 */
const MAX_WALK_DEPTH = 10;

export class CacheDependencyGraph {
  /** node -> keys that depend on it, directly. */
  private readonly dependents = new Map<DependencyNode, Set<string>>();

  /** key -> nodes it depends on. Kept so a key can be cleanly deregistered. */
  private readonly dependencies = new Map<string, Set<DependencyNode>>();

  /** node -> nodes that derive from it, for transitive walks. */
  private readonly nodeEdges = new Map<DependencyNode, Set<DependencyNode>>();

  /**
   * Record that `key` was derived from `dependsOn`.
   *
   * Re-registering a key replaces its previous dependencies rather than adding
   * to them: a recomputed value may well depend on a different set, and
   * accumulating stale edges would slowly turn every invalidation into a purge.
   */
  register({ key, dependsOn }: DependencyRegistration): void {
    this.deregister(key);

    if (dependsOn.length === 0) return;

    const nodes = new Set(dependsOn);
    this.dependencies.set(key, nodes);

    for (const node of nodes) {
      let set = this.dependents.get(node);
      if (!set) {
        set = new Set();
        this.dependents.set(node, set);
      }
      set.add(key);
    }
  }

  /** Forget a key entirely — call after it is evicted. */
  deregister(key: string): void {
    const nodes = this.dependencies.get(key);
    if (!nodes) return;

    for (const node of nodes) {
      const set = this.dependents.get(node);
      if (!set) continue;
      set.delete(key);
      if (set.size === 0) this.dependents.delete(node);
    }

    this.dependencies.delete(key);
  }

  /**
   * Declare that `derived` is computed from `source`.
   *
   * Lets invalidation cascade between *entities* rather than only from entity
   * to key — invalidating `mentor:42` can then also reach keys registered
   * against `mentor-search:category:5`.
   */
  link(source: DependencyNode, derived: DependencyNode): void {
    if (source === derived) return; // self-edges say nothing and risk a cycle

    let set = this.nodeEdges.get(source);
    if (!set) {
      set = new Set();
      this.nodeEdges.set(source, set);
    }
    set.add(derived);
  }

  /** Keys registered directly against `node`. */
  directDependents(node: DependencyNode): string[] {
    return [...(this.dependents.get(node) ?? [])];
  }

  /**
   * Every cache key invalidated by a change to `node`, following node links
   * transitively.
   *
   * Returns a de-duplicated array. Cycles terminate via the visited set, and
   * the depth cap bounds fan-out on a badly modelled graph.
   */
  resolveInvalidations(node: DependencyNode): string[] {
    const keys = new Set<string>();
    const visitedNodes = new Set<DependencyNode>();
    let frontier: DependencyNode[] = [node];
    let depth = 0;

    while (frontier.length > 0 && depth < MAX_WALK_DEPTH) {
      const next: DependencyNode[] = [];

      for (const current of frontier) {
        if (visitedNodes.has(current)) continue;
        visitedNodes.add(current);

        for (const key of this.dependents.get(current) ?? []) {
          keys.add(key);
        }
        for (const derived of this.nodeEdges.get(current) ?? []) {
          if (!visitedNodes.has(derived)) next.push(derived);
        }
      }

      frontier = next;
      depth += 1;
    }

    return [...keys];
  }

  /** Resolve invalidations for several changed entities at once. */
  resolveMany(nodes: DependencyNode[]): string[] {
    const keys = new Set<string>();
    for (const node of nodes) {
      for (const key of this.resolveInvalidations(node)) keys.add(key);
    }
    return [...keys];
  }

  stats(): GraphStats {
    let edges = 0;
    for (const set of this.dependents.values()) edges += set.size;
    for (const set of this.nodeEdges.values()) edges += set.size;

    return {
      trackedKeys: this.dependencies.size,
      trackedNodes: this.dependents.size,
      edges,
    };
  }

  clear(): void {
    this.dependents.clear();
    this.dependencies.clear();
    this.nodeEdges.clear();
  }
}
