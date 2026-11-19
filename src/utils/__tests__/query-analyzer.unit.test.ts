import { QueryAnalyzer } from "../query-analyzer";

describe("QueryAnalyzer", () => {
  it("detects large sequential scans and emits index suggestions", () => {
    const plan = {
      "Plan": {
        "Node Type": "Seq Scan",
        "Relation Name": "sessions",
        "Actual Rows": 15000,
        "Actual Total Time": 420.3,
        "Filter": "mentor_id = 42 AND status = 'confirmed'"
      }
    };

    const analysis = QueryAnalyzer.analyzeExplainPlan(plan);

    expect(analysis.summary).toContain("sequential scan");
    expect(analysis.issues.length).toBeGreaterThan(0);
    expect(analysis.recommendations.some((r) => r.table === "sessions")).toBe(true);
    expect(analysis.recommendations[0].sql).toContain("CREATE INDEX");
  });

  it("summarizes a healthy plan without warnings", () => {
    const plan = {
      "Plan": {
        "Node Type": "Index Scan",
        "Index Name": "idx_sessions_mentor_scheduled",
        "Relation Name": "sessions",
        "Actual Rows": 42,
        "Actual Total Time": 1.4,
        "Index Cond": "(mentor_id = 42)"
      }
    };

    const analysis = QueryAnalyzer.analyzeExplainPlan(plan);

    expect(analysis.warnings).toEqual([]);
    expect(analysis.issues).toEqual([]);
    expect(analysis.summary).toContain("efficient");
  });
});
