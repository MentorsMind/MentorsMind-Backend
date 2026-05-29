import { Router, Request, Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import { swaggerOptions } from "../config/swagger";

const router = Router();

// Lazily build the spec once
let cachedSpec: Record<string, unknown> | null = null;
function getSpec(): Record<string, unknown> {
  if (!cachedSpec) {
    cachedSpec = swaggerJsdoc(swaggerOptions) as Record<string, unknown>;
  }
  return cachedSpec;
}

/**
 * @swagger
 * /docs/portal:
 *   get:
 *     summary: API Documentation Portal
 *     description: Returns a structured overview of all API endpoints grouped by tag.
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: API portal overview
 */
router.get("/portal", (_req: Request, res: Response) => {
  const spec = getSpec();
  const paths = (spec.paths as Record<string, Record<string, unknown>>) ?? {};
  const tags = (spec.tags as { name: string; description?: string }[]) ?? [];

  // Build grouped endpoint index
  const grouped: Record<
    string,
    { method: string; path: string; summary: string; operationId?: string }[]
  > = {};

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const op = operation as {
        tags?: string[];
        summary?: string;
        operationId?: string;
      };
      const opTags = op.tags ?? ["Uncategorized"];
      for (const tag of opTags) {
        if (!grouped[tag]) grouped[tag] = [];
        grouped[tag].push({
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? "",
          operationId: op.operationId,
        });
      }
    }
  }

  const tagMap = Object.fromEntries(
    tags.map((t) => [t.name, t.description ?? ""]),
  );

  const sections = Object.entries(grouped).map(([tag, endpoints]) => ({
    tag,
    description: tagMap[tag] ?? "",
    endpointCount: endpoints.length,
    endpoints,
  }));

  res.json({
    success: true,
    data: {
      title: (spec.info as { title?: string })?.title ?? "API",
      version: (spec.info as { version?: string })?.version ?? "1.0.0",
      totalEndpoints: Object.values(grouped).reduce(
        (sum, eps) => sum + eps.length,
        0,
      ),
      totalTags: sections.length,
      sections,
      links: {
        swaggerUi: "/api/v1/docs",
        openApiSpec: "/api/v1/docs/spec.json",
        changelog: "/api/v1/docs/changelog",
        sdkGuide: "/api/v1/docs/sdk-guide",
      },
    },
  });
});

/**
 * @swagger
 * /docs/changelog:
 *   get:
 *     summary: API Changelog
 *     description: Returns the API version history and breaking change log.
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: Changelog entries
 */
router.get("/changelog", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      currentVersion: "1.0.0",
      entries: [
        {
          version: "1.0.0",
          date: "2026-01-01",
          type: "major",
          changes: [
            "Initial stable release",
            "Auth, Users, Mentors, Bookings, Payments, Wallets",
            "Stellar blockchain integration",
          ],
        },
        {
          version: "1.1.0",
          date: "2026-02-01",
          type: "minor",
          changes: [
            "Added Learning Path Builder",
            "Session milestone tracking",
            "Certification system",
          ],
        },
        {
          version: "1.2.0",
          date: "2026-03-01",
          type: "minor",
          changes: [
            "Advanced analytics dashboard",
            "Session recording and transcription",
            "Referral program",
          ],
        },
        {
          version: "1.3.0",
          date: "2026-04-01",
          type: "minor",
          changes: [
            "Session Quality Analytics with ML scoring (#538)",
            "Comprehensive API Documentation Portal (#537)",
            "Trend detection with linear regression",
            "Sentiment analysis for session feedback",
          ],
        },
      ],
    },
  });
});

/**
 * @swagger
 * /docs/sdk-guide:
 *   get:
 *     summary: SDK and Integration Guide
 *     description: Returns code examples and integration guidance for common use cases.
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: SDK guide with code examples
 */
router.get("/sdk-guide", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      authentication: {
        description: "Obtain a JWT token and include it in all requests.",
        example: {
          language: "typescript",
          code: `// 1. Login
const { data } = await axios.post('/api/v1/auth/login', {
  email: 'user@example.com',
  password: 'SecurePass1',
});
const token = data.data.accessToken;

// 2. Use token in subsequent requests
const client = axios.create({
  baseURL: 'https://api.mentorminds.com/api/v1',
  headers: { Authorization: \`Bearer \${token}\` },
});`,
        },
      },
      sessionQualityAnalytics: {
        description:
          "Retrieve ML-based quality scores and trend analysis for sessions.",
        example: {
          language: "typescript",
          code: `// Get quality score for a session
const score = await client.get(\`/session-quality/sessions/\${sessionId}\`);
console.log(score.data.data.overallScore); // 0-100

// Get mentor quality trend (last 90 days)
const trend = await client.get(\`/session-quality/mentors/\${mentorId}/trend?days=90\`);
console.log(trend.data.data.trend); // "improving" | "declining" | "stable"

// Get actionable insights
const insights = await client.get(\`/session-quality/mentors/\${mentorId}/insights\`);
insights.data.data.forEach(i => console.log(i.type, i.title));`,
        },
      },
      pagination: {
        description: "All list endpoints support page/limit query parameters.",
        example: {
          language: "typescript",
          code: `const { data } = await client.get('/mentors', {
  params: { page: 1, limit: 20, sortOrder: 'desc' },
});
// data.meta: { page, limit, total, totalPages }`,
        },
      },
      errorHandling: {
        description: "All errors follow a consistent shape.",
        example: {
          language: "typescript",
          code: `try {
  await client.post('/bookings', payload);
} catch (err) {
  if (axios.isAxiosError(err)) {
    const { status, data } = err.response!;
    // data.success === false
    // data.error — human-readable message
    console.error(status, data.error);
  }
}`,
        },
      },
      rateLimiting: {
        description:
          "The API enforces rate limits. Check response headers for current usage.",
        headers: {
          "X-RateLimit-Limit": "Maximum requests per window",
          "X-RateLimit-Remaining": "Requests remaining in current window",
          "X-RateLimit-Reset": "Unix timestamp when the window resets",
        },
      },
      webhooks: {
        description:
          "Register a webhook URL to receive real-time event notifications.",
        events: [
          "booking.confirmed",
          "booking.cancelled",
          "session.completed",
          "payment.succeeded",
          "payment.failed",
          "review.submitted",
        ],
        example: {
          language: "typescript",
          code: `await client.post('/webhooks', {
  url: 'https://your-app.com/webhooks/mentorminds',
  events: ['booking.confirmed', 'session.completed'],
  secret: 'your-webhook-secret',
});`,
        },
      },
    },
  });
});

/**
 * @swagger
 * /docs/health-status:
 *   get:
 *     summary: API health and status summary
 *     description: Returns a quick summary of API availability and key metrics.
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: Health status
 */
router.get("/health-status", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: "operational",
      version: "1.0.0",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      endpoints: {
        total: Object.keys(
          (getSpec().paths as Record<string, unknown>) ?? {},
        ).length,
        documented: Object.keys(
          (getSpec().paths as Record<string, unknown>) ?? {},
        ).length,
      },
      links: {
        health: "/health/ready",
        metrics: "/metrics",
        docs: "/api/v1/docs",
      },
    },
  });
});

export default router;
