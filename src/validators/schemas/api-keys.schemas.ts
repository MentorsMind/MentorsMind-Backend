import { z } from "zod";

/**
 * Schema for creating a new API key
 */
export const createApiKeySchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(3, "Name must be at least 3 characters")
      .max(100, "Name must not exceed 100 characters")
      .describe("A descriptive name for the API key"),
    
    scopes: z
      .array(z.string())
      .min(1, "At least one scope is required")
      .describe("Array of permission scopes for this key"),
    
    rate_limit: z
      .number()
      .int()
      .min(1, "Rate limit must be at least 1")
      .max(100000, "Rate limit cannot exceed 100,000")
      .optional()
      .default(1000)
      .describe("Maximum requests per hour for this key"),
    
    description: z
      .string()
      .max(500, "Description must not exceed 500 characters")
      .optional()
      .describe("Optional description of what this key is used for"),
    
    expires_at: z
      .string()
      .datetime()
      .optional()
      .describe("Optional expiration date (ISO 8601 format)"),
  }),
});

/**
 * Schema for API key ID parameter
 */
export const apiKeyIdParamSchema = z.object({
  params: z.object({
    id: z
      .string()
      .uuid("Invalid API key ID format")
      .describe("UUID of the API key"),
  }),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type ApiKeyIdParam = z.infer<typeof apiKeyIdParamSchema>;
