import {
  ApiKeyModel,
  CreateApiKeyPayload,
  ApiKey,
} from "../models/api-key.model";
import { createError } from "../middleware/errorHandler";

const VALID_SCOPES = [
  "bookings:read",
  "bookings:write",
  "sessions:read",
  "users:read",
  "mentors:read",
  "payments:read",
  "reviews:read",
  "webhooks:write",
];

export const ApiKeyService = {
  async create(
    userId: string,
    payload: Omit<CreateApiKeyPayload, "userId">,
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    const invalidScopes = payload.scopes.filter(
      (s) => !VALID_SCOPES.includes(s),
    );
    if (invalidScopes.length) {
      throw createError(`Invalid scopes: ${invalidScopes.join(", ")}`, 400);
    }
    return ApiKeyModel.create({ ...payload, userId });
  },

  async list(userId: string): Promise<ApiKey[]> {
    return ApiKeyModel.findByUser(userId);
  },

  async revoke(id: string, userId: string): Promise<void> {
    const revoked = await ApiKeyModel.revoke(id, userId);
    if (!revoked)
      throw createError("API key not found or not owned by user", 404);
  },

  listScopes(): string[] {
    return VALID_SCOPES;
  },

  async authenticate(rawKey: string) {
    return ApiKeyModel.authenticate(rawKey);
  },
};
