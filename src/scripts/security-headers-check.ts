/**
 * security-headers-check.ts (issue #785)
 *
 * Verifies that every required security header is present on API responses.
 * Run against a live instance (defaults to the CI test server) as a required
 * CI gate, separate from the OWASP ZAP scan:
 *
 *   ts-node --transpile-only src/scripts/security-headers-check.ts
 *
 * Configure the target with SECURITY_CHECK_BASE_URL (default
 * http://localhost:5001/api/v1) and, if needed, SECURITY_CHECK_PATHS (a
 * comma-separated list of paths to sample, default covers a public route,
 * the health check, and the metrics endpoint).
 */
import axios from "axios";

const BASE_URL = process.env.SECURITY_CHECK_BASE_URL ?? "http://localhost:5001/api/v1";
const ORIGIN = new URL(BASE_URL).origin;

// A representative sample: a public docs endpoint (under the API version
// prefix), plus the root-level health check and metrics endpoints.
const API_PATHS = (process.env.SECURITY_CHECK_PATHS ?? "/docs/health-status")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => `${BASE_URL}${p}`);

const ROOT_PATHS = (process.env.SECURITY_CHECK_ROOT_PATHS ?? "/health/ready,/metrics")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => `${ORIGIN}${p}`);

const URLS = [...API_PATHS, ...ROOT_PATHS];

const REQUIRED_HEADERS: Record<string, (value: string) => boolean> = {
  "strict-transport-security": (v) => v.length > 0,
  "x-content-type-options": (v) => v.toLowerCase() === "nosniff",
  "x-frame-options": (v) => v.length > 0,
  "content-security-policy": (v) => v.length > 0,
  "referrer-policy": (v) => v.length > 0,
};

interface CheckResult {
  path: string;
  missing: string[];
  status: number | "error";
}

async function checkPath(url: string): Promise<CheckResult> {
  try {
    const response = await axios.get(url, {
      validateStatus: () => true,
      maxRedirects: 0,
    });

    const missing = Object.entries(REQUIRED_HEADERS)
      .filter(([header, isValid]) => {
        const value = response.headers[header];
        return typeof value !== "string" || !isValid(value);
      })
      .map(([header]) => header);

    return { path: url, missing, status: response.status };
  } catch {
    return {
      path: url,
      missing: Object.keys(REQUIRED_HEADERS),
      status: "error",
    };
  }
}

async function main(): Promise<void> {
  const results = await Promise.all(URLS.map(checkPath));

  let hasFailure = false;
  for (const result of results) {
    if (result.missing.length > 0) {
      hasFailure = true;
      logger.error(
        `[FAIL] ${result.path} (status: ${result.status}) — missing/invalid headers: ${result.missing.join(", ")}`,
      );
    } else {
      logger.info(`[PASS] ${result.path} (status: ${result.status})`);
    }
  }

  if (hasFailure) {
    logger.error("\nSecurity headers check failed — see docs/SECURITY_SCANNING_RUNBOOK.md for remediation.");
    process.exit(1);
  }

  logger.info("\nAll required security headers present.");
}

main().catch((error) => {
  logger.error("security-headers-check crashed:", error);
  process.exit(1);
});
