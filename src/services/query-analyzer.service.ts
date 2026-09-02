/**
 * Query analysis and index recommendation (issue #859).
 *
 * `middleware/queryLogger` already captures slow queries and their EXPLAIN
 * plans, and `QueryMonitorService` stores latency percentiles per fingerprint.
 * What was missing is the step that turns a captured plan into a *decision*:
 * which scan is the expensive one, and what index would remove it.
 *
 * This reads plans rather than guessing from SQL text, because the planner is
 * the only thing that knows which predicate actually drove the cost.
 */

import pool from "../config/database";
import { logger } from "../utils/logger";
import databaseTuning from "../config/database-tuning";

export interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Total Cost"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Plan Rows"?: number;
  Filter?: string;
  "Index Name"?: string;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

export interface PlanFinding {
  kind:
    | "sequential-scan"
    | "row-estimate-drift"
    | "external-sort"
    | "nested-loop-over-scan";
  relation?: string;
  detail: string;
  /** Rough ordering hint; higher is worse. */
  weight: number;
}

export interface IndexSuggestion {
  table: string;
  columns: string[];
  /** `CREATE INDEX CONCURRENTLY ...` — never executed automatically. */
  statement: string;
  reason: string;
}

export interface QueryAnalysis {
  fingerprint: string;
  findings: PlanFinding[];
  suggestions: IndexSuggestion[];
  totalCost?: number;
  actualTimeMs?: number;
}

/** Walk a plan tree depth-first. */
function walk(node: PlanNode, visit: (n: PlanNode) => void): void {
  visit(node);
  for (const child of node.Plans ?? []) walk(child, visit);
}

/**
 * Columns referenced by a planner `Filter` expression.
 *
 * Deliberately conservative: it extracts bare identifiers on the left of a
 * comparison and ignores anything it cannot parse confidently. A missed column
 * costs a suggestion; a wrong one costs a pointless index on a large table.
 */
export function columnsFromFilter(filter: string): string[] {
  const columns = new Set<string>();
  const pattern = /\(?\b([a-z_][a-z0-9_]*)\b\s*(?:=|>|<|>=|<=|<>|~~|IS)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(filter)) !== null) {
    const name = match[1].toLowerCase();
    if (["and", "or", "not", "null", "true", "false"].includes(name)) continue;
    columns.add(name);
  }
  return [...columns];
}

/**
 * Inspect a plan tree and report what is expensive about it.
 */
export function analyzePlan(root: PlanNode): PlanFinding[] {
  const findings: PlanFinding[] = [];

  walk(root, (node) => {
    const type = node["Node Type"] ?? "";
    const relation = node["Relation Name"];
    const actualRows = node["Actual Rows"] ?? 0;
    const planRows = node["Plan Rows"] ?? 0;

    if (type === "Seq Scan" && relation) {
      // A sequential scan is only interesting when the table is big enough
      // that an index would plausibly win.
      if (actualRows >= 1000) {
        findings.push({
          kind: "sequential-scan",
          relation,
          detail: `Seq Scan on ${relation} returned ${actualRows} rows${
            node.Filter ? ` filtering on ${node.Filter}` : ""
          }`,
          weight: actualRows,
        });
      }
    }

    // A planner estimate an order of magnitude out usually means stale
    // statistics, and it is what drives the planner into the wrong join.
    if (planRows > 0 && actualRows > 0) {
      const ratio = actualRows / planRows;
      if (ratio >= 10 || ratio <= 0.1) {
        findings.push({
          kind: "row-estimate-drift",
          relation,
          detail: `Planner expected ${planRows} rows, got ${actualRows} (${ratio.toFixed(1)}x)`,
          weight: Math.abs(actualRows - planRows),
        });
      }
    }

    if (type === "Sort" && node["Sort Method"] === "external merge") {
      findings.push({
        kind: "external-sort",
        relation,
        detail: "Sort spilled to disk; consider raising work_mem or indexing the sort key",
        weight: actualRows,
      });
    }

    if (type === "Nested Loop") {
      const inner = (node.Plans ?? [])[1];
      if (inner && inner["Node Type"] === "Seq Scan") {
        findings.push({
          kind: "nested-loop-over-scan",
          relation: inner["Relation Name"],
          detail: `Nested Loop repeatedly scanning ${inner["Relation Name"] ?? "inner relation"}`,
          weight: actualRows * 2,
        });
      }
    }
  });

  return findings.sort((a, b) => b.weight - a.weight);
}

/**
 * Turn findings into index suggestions.
 *
 * Suggestions are emitted as `CREATE INDEX CONCURRENTLY` text and are **never
 * executed**. Creating an index is a write against production storage with a
 * lasting write-amplification cost; that is a human decision, and the issue's
 * "automated index optimization" is read as automated *recommendation*.
 */
export function suggestIndexes(root: PlanNode, findings: PlanFinding[]): IndexSuggestion[] {
  const suggestions: IndexSuggestion[] = [];
  const seen = new Set<string>();

  walk(root, (node) => {
    if (node["Node Type"] !== "Seq Scan") return;
    const table = node["Relation Name"];
    const filter = node.Filter;
    if (!table || !filter) return;
    if (!findings.some((f) => f.relation === table && f.kind === "sequential-scan")) return;

    const columns = columnsFromFilter(filter);
    if (columns.length === 0) return;

    const key = `${table}:${columns.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);

    const indexName = `idx_${table}_${columns.join("_")}`.slice(0, 63);
    suggestions.push({
      table,
      columns,
      statement: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${table} (${columns.join(", ")});`,
      reason: `Seq Scan on ${table} filtering ${columns.join(", ")}`,
    });
  });

  return suggestions;
}

export const QueryAnalyzerService = {
  /**
   * Explain a query and report findings.
   *
   * Runs `EXPLAIN (FORMAT JSON)` **without** ANALYZE by default: ANALYZE
   * executes the statement, which is unacceptable for anything with side
   * effects. Callers that know the query is a pure read may opt in.
   */
  async explain(
    sql: string,
    params: unknown[] = [],
    opts: { analyze?: boolean } = {},
  ): Promise<QueryAnalysis | null> {
    const mode = opts.analyze ? "ANALYZE, BUFFERS, FORMAT JSON" : "FORMAT JSON";
    try {
      const result = await pool.query(`EXPLAIN (${mode}) ${sql}`, params);
      const plan = (result.rows?.[0]?.["QUERY PLAN"] ?? [])[0]?.Plan as PlanNode | undefined;
      if (!plan) return null;

      const findings = analyzePlan(plan);
      return {
        fingerprint: fingerprint(sql),
        findings,
        suggestions: suggestIndexes(plan, findings),
        totalCost: plan["Total Cost"],
        actualTimeMs: plan["Actual Total Time"],
      };
    } catch (error) {
      // Analysis is best-effort telemetry and must never surface to a caller.
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Query analysis failed",
      );
      return null;
    }
  },

  /** Whether a query qualifies for analysis under the configured thresholds. */
  shouldAnalyze(durationMs: number): boolean {
    const { slowQueryMs, criticalQueryMs, analysisSampleRate } = databaseTuning.query;
    if (durationMs >= criticalQueryMs) return true;
    if (durationMs < slowQueryMs) return false;
    return Math.random() < analysisSampleRate;
  },
};

/** Normalise a statement so the same shape hashes identically. */
export function fingerprint(sql: string): string {
  return sql
    .replace(/'[^']*'/g, "?")
    .replace(/\b\d+\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export default QueryAnalyzerService;
