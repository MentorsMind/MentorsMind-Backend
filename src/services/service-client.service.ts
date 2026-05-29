import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { logger } from "../utils/logger";
import { redis } from "../config/redis";

// Retry Policy Interface
export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
}

// Service Client Interface
export interface ServiceClientConfig {
  serviceName: string;
  baseUrl: string;
  timeout?: number;
  retryPolicy?: Partial<RetryPolicy>;
}

// Default Retry Policy
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Service Registry & Discovery (simple Redis-based for now)
 */
export class ServiceRegistry {
  private static readonly KEY_PREFIX = "services:registry:";
  private static readonly TTL_SECONDS = 30;

  static async register(serviceName: string, serviceUrl: string): Promise<void> {
    try {
      const key = `${this.KEY_PREFIX}${serviceName}`;
      const services = JSON.parse((await redis.get(key)) || "[]");
      if (!services.includes(serviceUrl)) {
        services.push(serviceUrl);
      }
      await redis.setex(key, this.TTL_SECONDS, JSON.stringify(services));
      logger.info(`Service registered: ${serviceName} at ${serviceUrl}`);
    } catch (error) {
      logger.error(`Failed to register service ${serviceName}:`, error);
    }
  }

  static async discover(serviceName: string): Promise<string | null> {
    try {
      const key = `${this.KEY_PREFIX}${serviceName}`;
      const services = JSON.parse((await redis.get(key)) || "[]");
      if (services.length === 0) return null;
      // Simple round-robin selection
      const index = Math.floor(Math.random() * services.length);
      return services[index];
    } catch (error) {
      logger.error(`Failed to discover service ${serviceName}:`, error);
      return null;
    }
  }

  static async deregister(serviceName: string, serviceUrl: string): Promise<void> {
    try {
      const key = `${this.KEY_PREFIX}${serviceName}`;
      let services = JSON.parse((await redis.get(key)) || "[]");
      services = services.filter((url: string) => url !== serviceUrl);
      await redis.setex(key, this.TTL_SECONDS, JSON.stringify(services));
      logger.info(`Service deregistered: ${serviceName} from ${serviceUrl}`);
    } catch (error) {
      logger.error(`Failed to deregister service ${serviceName}:`, error);
    }
  }
}

/**
 * HTTP Service Client with Retry & Circuit Breaker
 */
export class ServiceClient {
  private axios: AxiosInstance;
  private config: ServiceClientConfig;
  private retryPolicy: RetryPolicy;
  private circuitOpen: boolean = false;
  private circuitOpenUntil: number = 0;
  private failureCount: number = 0;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT_MS = 30000;

  constructor(config: ServiceClientConfig) {
    this.config = config;
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...config.retryPolicy };
    
    this.axios = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 10000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Request interceptor for logging & correlation ID
    this.axios.interceptors.request.use(
      (request) => {
        const correlationId = 
          request.headers["x-correlation-id"] || 
          crypto.randomUUID();
        request.headers["x-correlation-id"] = correlationId;
        request.headers["x-service-name"] = "monolith";
        logger.debug(`Service request: ${request.method?.toUpperCase()} ${request.url}`, {
          service: config.serviceName,
          correlationId,
        });
        return request;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for logging
    this.axios.interceptors.response.use(
      (response) => {
        logger.debug(`Service response: ${response.status} ${response.config.url}`, {
          service: config.serviceName,
        });
        return response;
      },
      (error) => {
        logger.warn(`Service request failed: ${error.config?.url}`, {
          service: config.serviceName,
          error: error.message,
          status: error.response?.status,
        });
        return Promise.reject(error);
      }
    );
  }

  private async wait(delayMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }

  private isCircuitOpen(): boolean {
    if (this.circuitOpen && Date.now() < this.circuitOpenUntil) {
      return true;
    }
    this.circuitOpen = false;
    this.failureCount = 0;
    return false;
  }

  private recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitOpen = true;
      this.circuitOpenUntil = Date.now() + this.CIRCUIT_BREAKER_TIMEOUT_MS;
      logger.warn(`Circuit breaker OPEN for ${this.config.serviceName}`);
    }
  }

  async request<T = any>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    // Check circuit breaker
    if (this.isCircuitOpen()) {
      throw new Error(`Circuit breaker open for service: ${this.config.serviceName}`);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      try {
        const response = await this.axios.request<T>({
          method,
          url: path,
          data,
          ...config,
        });
        this.failureCount = 0;
        return response;
      } catch (error: any) {
        lastError = error;
        const statusCode = error.response?.status;
        const isRetryable = 
          this.retryPolicy.retryableStatusCodes.includes(statusCode) ||
          !error.response;

        if (!isRetryable || attempt === this.retryPolicy.maxRetries) {
          this.recordFailure();
          break;
        }

        // Calculate backoff delay
        const delayMs = Math.min(
          this.retryPolicy.initialDelayMs * Math.pow(this.retryPolicy.backoffMultiplier, attempt),
          this.retryPolicy.maxDelayMs
        );
        logger.debug(`Retrying request to ${this.config.serviceName}${path} in ${delayMs}ms (attempt ${attempt + 1}/${this.retryPolicy.maxRetries})`);
        await this.wait(delayMs);
      }
    }

    throw lastError;
  }

  async get<T = any>(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request("GET", path, undefined, config);
  }

  async post<T = any>(path: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request("POST", path, data, config);
  }

  async put<T = any>(path: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request("PUT", path, data, config);
  }

  async patch<T = any>(path: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request("PATCH", path, data, config);
  }

  async delete<T = any>(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request("DELETE", path, undefined, config);
  }
}

// Pre-configured service clients
export const ServiceClients = {
  auth: new ServiceClient({
    serviceName: "auth-service",
    baseUrl: process.env.AUTH_SERVICE_URL || "http://localhost:5001",
  }),
  user: new ServiceClient({
    serviceName: "user-service",
    baseUrl: process.env.USER_SERVICE_URL || "http://localhost:5002",
  }),
  booking: new ServiceClient({
    serviceName: "booking-service",
    baseUrl: process.env.BOOKING_SERVICE_URL || "http://localhost:5003",
  }),
  payment: new ServiceClient({
    serviceName: "payment-service",
    baseUrl: process.env.PAYMENT_SERVICE_URL || "http://localhost:5004",
  }),
  notification: new ServiceClient({
    serviceName: "notification-service",
    baseUrl: process.env.NOTIFICATION_SERVICE_URL || "http://localhost:5005",
  }),
  analytics: new ServiceClient({
    serviceName: "analytics-service",
    baseUrl: process.env.ANALYTICS_SERVICE_URL || "http://localhost:5006",
  }),
};
