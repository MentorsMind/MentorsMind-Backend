export interface QueryAnalysisIssue {
  type: "sequential_scan" | "missing_index" | "expensive_sort" | "nested_loop";
  table?: string;
  detail: string;
  rows?: number;
  severity: "low" | "medium" | "high";
}

export interface QueryAnalysisRecommendation {
  table: string;
  columns: string[];
  reason: string;
  sql: string;
  severity: "low" | "medium" | "high";
}

export interface QueryAnalysisResult {
  summary: string;
  warnings: string[];
  issues: QueryAnalysisIssue[];
  recommendations: QueryAnalysisRecommendation[];
}

interface PlanNode {
  [key: string]: unknown;
  "Node Type"?: string;
  "Relation Name"?: string;
  "Actual Rows"?: number;
  "Filter"?: string;
  "Index Cond"?: string;
  "Sort Key"?: unknown;
  "Plans"?: PlanNode[];
}

export class QueryAnalyzer {
  static analyzeExplainPlan(plan: unknown): QueryAnalysisResult {
    const nodes = this.collectPlanNodes(plan);
    const issues: QueryAnalysisIssue[] = [];
    const recommendations: QueryAnalysisRecommendation[] = [];
    const warnings: string[] = [];

    for (const node of nodes) {
      const nodeType = String(node["Node Type"] ?? "");
      const table = this.extractTableName(node);
      const actualRows = this.toNumber(node["Actual Rows"]);
      const filter = this.readText(node["Filter"]) || this.readText(node["Index Cond"]);

      if (nodeType === "Seq Scan" && table && actualRows > 10000) {
        const detail = `Sequential scan detected on ${table} (${actualRows.toLocaleString()} rows).`;
        issues.push({
          type: "sequential_scan",
          table,
          detail,
          rows: actualRows,
          severity: actualRows > 200000 ? "high" : "medium",
        });
        warnings.push(detail);

        const columns = this.extractColumnsFromFilter(filter);
        const recommendation = this.buildRecommendation(table, columns, detail, "sequential scan");
        if (recommendation) {
          recommendations.push(recommendation);
        }
      }

      if (nodeType === "Sort" && this.toNumber(node["Actual Rows"]) > 50000) {
        const detail = `Large sort operation observed in query plan.`;
        issues.push({
          type: "expensive_sort",
          detail,
          rows: this.toNumber(node["Actual Rows"]),
          severity: "medium",
        });
        warnings.push(detail);
      }

      if (
        nodeType === "Nested Loop" &&
        table &&
        actualRows > 5000 &&
        typeof node["Filter"] === "string"
      ) {
        issues.push({
          type: "nested_loop",
          table,
          detail: `Potentially expensive nested-loop join on ${table}.`,
          rows: actualRows,
          severity: "medium",
        });
      }
    }

    const summary = issues.length === 0
      ? "Query plan is efficient and uses index-based access patterns without large sequential scans."
      : `Query plan shows ${issues.length} potential performance issue(s), primarily driven by sequential scans and index gaps.`;

    return {
      summary,
      warnings,
      issues,
      recommendations,
    };
  }

  private static collectPlanNodes(plan: unknown): PlanNode[] {
    const nodes: PlanNode[] = [];

    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;

      const record = node as PlanNode;
      if (record["Node Type"]) {
        nodes.push(record);
      }

      if (Array.isArray(record["Plans"])) {
        for (const child of record["Plans"]) visit(child);
      }

      if (record["Plan"] && typeof record["Plan"] === "object") {
        visit(record["Plan"]);
      }

      if (record["PLAN"] && typeof record["PLAN"] === "object") {
        visit(record["PLAN"]);
      }
    };

    visit(plan);
    return nodes;
  }

  private static extractTableName(node: PlanNode): string | undefined {
    const relationName = this.readText(node["Relation Name"]);
    if (relationName) return relationName;
   
    const indexName = this.readText(node["Index Name"]);
    if (indexName && indexName.includes("on")) {
      const segments = indexName.split(" on ");
      if (segments.length > 1) return segments[1].split(" ")[0];
    }

    return undefined;
  }

  private static extractColumnsFromFilter(filterText?: string): string[] {
    if (!filterText) return [];

    const matches = Array.from(filterText.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|<>|!=|IN|LIKE|BETWEEN|<|>|\sIS\sNOT\sNULL|\sIS\sNULL)/g));
    const columns = matches
      .map((match) => match[1])
      .filter((column) => !["AND", "OR", "NOT", "NULL", "IS"].includes(column.toUpperCase()));

    return [...new Set(columns)].slice(0, 3);
  }

  private static buildRecommendation(
    table: string,
    columns: string[],
    detail: string,
    scanType: string,
  ): QueryAnalysisRecommendation | null {
    const candidateColumns = columns.length > 0 ? columns : ["created_at"];
    const indexColumns = candidateColumns.slice(0, 2).join(", ");
    const indexName = `idx_${table}_${candidateColumns.slice(0, 2).join("_")}_${scanType.replace(/\s+/g, "_")}`;

    if (!table) return null;

    return {
      table,
      columns: candidateColumns,
      reason: detail,
      sql: `CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} (${indexColumns});`,
      severity: detail.includes("rows") && detail.includes("200000") ? "high" : "medium",
    };
  }

  private static readText(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return undefined;
  }

  private static toNumber(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }
}

export default QueryAnalyzer;
