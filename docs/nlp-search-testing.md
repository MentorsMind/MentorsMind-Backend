# NLP Search — Relevance Testing Methodology

This document describes how to validate the structured natural-language search
implemented in `NlpSearchService` (`src/services/nlp-search.service.ts`) and its
helpers in `src/utils/query-parser.utils.ts`.

## 1. Unit tests — structured extraction

Goal: verify `parseQuery` extracts the documented filter schema.

| Input query | Expected extraction |
| --- | --- |
| `"Python tutor under $50"` | `{ skills: ["Python"], maxBudget: 50 }` |
| `"affordable python coach for beginners"` | `{ skills:["Python"], maxBudget: 50, experienceLevel:"beginner", sessionType:"coaching" }` |
| `"machine learning mentor with 4.5 stars available on weekends"` | `{ skills:["Machine Learning"], minRating:4.5, availability:["weekend"] }` |
| `"advanced Spanish group class"` | `{ experienceLevel:"advanced", language:"spanish", sessionType:"group" }` |

Assertions:
- `parsed.skills` contains canonical skill names (not raw tokens).
- `parsed.maxBudget` is numeric for price phrases (`under`, `below`, `max`, `<=`).
- `parsed.experienceLevel` ∈ `beginner|intermediate|advanced|null`.
- `parsed.availability` includes `weekend`/`evening`/`morning` when mentioned.

## 2. Cache correctness & latency

- Call `parseQuery` twice with the same raw query.
  - Second call must have `fromCache === true`.
  - Measure parse time on the cached call; assert `< 5ms` (use `process.hrtime.bigint()`).
- Cache key must equal `SHA-256(normalizeQuery(q))`; verify with an independent
  `crypto.createHash('sha256')` computation.

## 3. Typo correction (Levenshtein)

- `"javscript"` → correction suggestion `"JavaScript"`.
- `"pyhton coach"` → `"Python"`.
- A correct token (e.g. `"python"`) must NOT be "corrected".
- Distance threshold (`maxDistance`) must not over-correct valid rare words.

## 4. OpenAI fallback

- With `OPENAI_API_KEY` unset, `parseQuery` must resolve via the deterministic
  keyword parser (no throw).
- With the OpenAI endpoint mocked to return a non-tool-call response, fallback
  must occur and search must still return results.

## 5. Suggestions (Elasticsearch prefix)

- `GET /api/v1/search/suggestions?q=py` → suggestions include `"Python"`.
- When Elasticsearch is disabled, the PostgreSQL `ILIKE` fallback must return
  matching skills.

## 6. Analytics capture

- After any search (including zero-result), a row must exist in
  `search_analytics` with `query`, `extracted_filters` (JSONB), and
  `result_count`. A zero-result search must have `has_results = false`.

## 7. Relevance scoring (offline evaluation)

1. Build a labeled set of `(query, relevantMentorIds)` from production or seed data.
2. For each query, run `NlpSearchService.search` and record the ranked list.
3. Compute **Precision@5, Recall@10, MRR** and the fraction of queries where a
   relevant mentor appears in the top 5.
4. Compare NLP parsing vs. raw keyword baseline to demonstrate lift.
5. Track the **zero-result rate** over time as a quality regression signal.

## 8. Load / latency

- p95 parse latency (cache miss, OpenAI) should stay under the 15s timeout.
- p95 suggestion latency under 200ms when Elasticsearch is healthy.
