/**
 * Request router & reverse proxy
 *
 * Resolves an inbound request to a service + instance (via the registry and
 * load balancer), then forwards it upstream with axios, streaming the response
 * back to the caller. Handles per-instance connection accounting, retries
 * against alternate instances, and circuit-breaker bookkeeping.
 */

import axios, { AxiosRequestConfig, Method } from "axios";
import type { Request, Response } from "express";
import type { RouteResolution, ServiceDefinition } from "./types";
import { selectInstance } from "./load-balancer";
import { ServiceRegistry } from "./service-registry";
import gatewayConfig from "./gateway.config";
import { logger } from "../utils/logger";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface ProxyOutcome {
  status: number;
  instanceId: string;
  upstreamMs: number;
  retries: number;
  failed: boolean;
}

export class RequestRouter {
  constructor(private readonly registry: ServiceRegistry) {}

  /** Resolve `path` to a concrete upstream target, or null if unroutable. */
  resolve(path: string): RouteResolution | null {
    const service = this.registry.matchServiceByPath(path);
    if (!service || service.instances.length === 0) return null;

    const strategy = service.strategy ?? gatewayConfig.defaultStrategy;
    const instance = selectInstance(service, strategy);
    if (!instance) return null;

    const upstreamPath = path.slice(service.prefix.length) || "/";
    return {
      service,
      instance,
      upstreamPath: upstreamPath.startsWith("/")
        ? upstreamPath
        : `/${upstreamPath}`,
    };
  }

  private buildHeaders(req: Request, instanceUrl: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }

    const fwdFor = req.headers["x-forwarded-for"];
    headers["x-forwarded-for"] = fwdFor
      ? `${Array.isArray(fwdFor) ? fwdFor[0] : fwdFor}, ${req.ip}`
      : String(req.ip ?? "");
    headers["x-forwarded-host"] = req.headers.host ?? "";
    headers["x-forwarded-proto"] = req.protocol;
    headers["x-gateway-forwarded"] = "true";
    if ((req as { id?: string }).id) {
      headers["x-request-id"] = String((req as { id?: string }).id);
    }
    void instanceUrl;
    return headers;
  }

  /**
   * Forward `req` to the resolved service, writing the upstream response to
   * `res`. Retries idempotent requests against other instances on transport
   * failure or 502/503/504.
   */
  async forward(
    req: Request,
    res: Response,
    resolution: RouteResolution,
  ): Promise<ProxyOutcome> {
    const { service } = resolution;
    const strategy = service.strategy ?? gatewayConfig.defaultStrategy;
    const canRetry = IDEMPOTENT_METHODS.has(req.method.toUpperCase());
    const maxAttempts = canRetry ? gatewayConfig.proxyRetries + 1 : 1;

    let attempt = 0;
    let lastError: unknown;
    let instance = resolution.instance;

    while (attempt < maxAttempts) {
      const started = Date.now();
      instance.activeConnections += 1;
      try {
        const axiosConfig: AxiosRequestConfig = {
          method: req.method as Method,
          url: `${instance.url}${resolution.upstreamPath}`,
          params: req.query,
          headers: this.buildHeaders(req, instance.url),
          data: ["GET", "HEAD"].includes(req.method.toUpperCase())
            ? undefined
            : req.body,
          timeout: gatewayConfig.proxyTimeoutMs,
          responseType: "stream",
          maxRedirects: 0,
          validateStatus: () => true,
        };

        const upstream = await axios.request(axiosConfig);
        const upstreamMs = Date.now() - started;

        const retryable =
          canRetry && [502, 503, 504].includes(upstream.status);
        if (retryable && attempt + 1 < maxAttempts) {
          lastError = new Error(`upstream ${upstream.status}`);
          instance.activeConnections = Math.max(0, instance.activeConnections - 1);
          attempt += 1;
          const next = selectInstance(service, strategy);
          if (next) instance = next;
          continue;
        }

        // Relay status + headers + body.
        res.status(upstream.status);
        for (const [key, value] of Object.entries(upstream.headers)) {
          if (HOP_BY_HOP.has(key.toLowerCase())) continue;
          res.setHeader(key, value as string);
        }
        res.setHeader("x-gateway-instance", instance.id);
        upstream.data.pipe(res);

        await new Promise<void>((resolve, reject) => {
          upstream.data.on("end", resolve);
          upstream.data.on("error", reject);
        });

        instance.activeConnections = Math.max(0, instance.activeConnections - 1);
        const failed = upstream.status >= 500;
        return {
          status: upstream.status,
          instanceId: instance.id,
          upstreamMs,
          retries: attempt,
          failed,
        };
      } catch (err) {
        lastError = err;
        instance.activeConnections = Math.max(0, instance.activeConnections - 1);
        instance.consecutiveFailures += 1;
        logger.warn("Gateway: upstream request failed", {
          service: service.name,
          instance: instance.id,
          attempt,
          error: (err as Error).message,
        });
        attempt += 1;
        if (attempt < maxAttempts) {
          const next = selectInstance(service, strategy);
          if (next) instance = next;
        }
      }
    }

    if (!res.headersSent) {
      res.status(502).json({
        status: "error",
        message: "Bad gateway — upstream service unavailable",
        error: (lastError as Error | undefined)?.message,
        timestamp: new Date().toISOString(),
      });
    }
    return {
      status: 502,
      instanceId: instance.id,
      upstreamMs: 0,
      retries: attempt - 1,
      failed: true,
    };
  }
}

export function stripPrefix(path: string, service: ServiceDefinition): string {
  const rest = path.slice(service.prefix.length) || "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}
