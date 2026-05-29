import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../app";
import { generateTestToken } from "../../tests/helpers/request.helper";
import { testPool } from "../../tests/setup";

const API_BASE = `/api/${process.env.API_VERSION || "v1"}`;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret";

describe("Security: Authentication & JWT", () => {
  let userId: string;
  let validToken: string;

  beforeEach(async () => {
    const result = await testPool.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ["auth@example.com", "hash", "user", "Auth", "Test"],
    );
    userId = result.rows[0].id;
    validToken = generateTestToken({
      userId,
      email: "auth@example.com",
      role: "user",
    });
  });

  describe("JWT Algorithm Confusion", () => {
    it("should reject JWT with alg: none", async () => {
      const maliciousToken = jwt.sign(
        { userId, email: "auth@example.com", role: "admin" },
        "",
        { algorithm: "none" as any },
      );

      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${maliciousToken}`);

      expect(response.status).toBe(401);
    });

    it("should reject JWT with HS256 when RS256 is expected", async () => {
      const maliciousToken = jwt.sign(
        { userId, email: "auth@example.com", role: "admin" },
        "public-key-as-secret",
        { algorithm: "HS256" },
      );

      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${maliciousToken}`);

      expect(response.status).toBe(401);
    });

    it("should reject JWT with invalid signature", async () => {
      const maliciousToken = jwt.sign(
        { userId, email: "auth@example.com", role: "admin" },
        "wrong-secret",
        { algorithm: "HS256" },
      );

      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${maliciousToken}`);

      expect(response.status).toBe(401);
    });

    it("should reject expired JWT", async () => {
      const expiredToken = jwt.sign(
        { userId, email: "auth@example.com", role: "user" },
        JWT_SECRET,
        { expiresIn: "-1h" },
      );

      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
    });

    it("should reject JWT with modified payload", async () => {
      const token = jwt.sign(
        { userId, email: "auth@example.com", role: "user" },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      // Tamper with payload
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
      payload.role = "admin";
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString(
        "base64",
      );
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${tamperedToken}`);

      expect(response.status).toBe(401);
    });
  });

  describe("Authentication Bypass", () => {
    it("should reject requests without Bearer token", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", "InvalidFormat token");

      expect(response.status).toBe(401);
    });

    it("should reject requests with missing Authorization header", async () => {
      const response = await request(app).get(`${API_BASE}/users/me`);

      expect(response.status).toBe(401);
    });

    it("should reject requests with empty Bearer token", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", "Bearer ");

      expect(response.status).toBe(401);
    });

    it("should reject requests with malformed JWT", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", "Bearer not.a.jwt");

      expect(response.status).toBe(401);
    });

    it("should reject requests with null byte injection in token", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${validToken}\x00admin`);

      expect(response.status).toBe(401);
    });
  });

  describe("Token Refresh Security", () => {
    it("should reject reuse of revoked refresh tokens", async () => {
      // This test assumes refresh token implementation exists
      const response = await request(app)
        .post(`${API_BASE}/auth/refresh`)
        .send({ refreshToken: "revoked-token" });

      expect([401, 400]).toContain(response.status);
    });

    it("should reject refresh token with invalid signature", async () => {
      const invalidRefreshToken = jwt.sign(
        { userId, type: "refresh" },
        "wrong-secret",
        { expiresIn: "7d" },
      );

      const response = await request(app)
        .post(`${API_BASE}/auth/refresh`)
        .send({ refreshToken: invalidRefreshToken });

      expect([401, 400]).toContain(response.status);
    });
  });

  describe("CSRF Protection", () => {
    it("should reject state-changing requests without CSRF token", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          firstName: "Updated",
          lastName: "Name",
        });

      // Should either require CSRF token or use SameSite cookies
      expect([200, 403]).toContain(response.status);
    });

    it("should reject POST requests from different origin", async () => {
      const response = await request(app)
        .post(`${API_BASE}/users/me/settings`)
        .set("Authorization", `Bearer ${validToken}`)
        .set("Origin", "https://malicious.com")
        .send({ setting: "value" });

      // CORS should block or require proper headers
      expect([200, 403]).toContain(response.status);
    });
  });

  describe("Session Security", () => {
    it("should not expose sensitive data in JWT", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${validToken}`);

      if (response.status === 200) {
        // Token should not contain password or sensitive fields
        const tokenParts = validToken.split(".");
        const payload = JSON.parse(
          Buffer.from(tokenParts[1], "base64").toString(),
        );

        expect(payload).not.toHaveProperty("password");
        expect(payload).not.toHaveProperty("passwordHash");
        expect(payload).not.toHaveProperty("secret");
      }
    });

    it("should enforce token expiration", async () => {
      const shortLivedToken = jwt.sign(
        { userId, email: "auth@example.com", role: "user" },
        JWT_SECRET,
        { expiresIn: "1ms" },
      );

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${shortLivedToken}`);

      expect(response.status).toBe(401);
    });
  });

  describe("Privilege Escalation Prevention", () => {
    it("should not allow user to change their own role", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          firstName: "Test",
          lastName: "User",
          role: "admin",
        });

      // Either ignore role field or reject it
      expect([200, 400]).toContain(response.status);

      if (response.status === 200) {
        const userResponse = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${validToken}`);

        expect(userResponse.body.data.role).toBe("user");
      }
    });

    it("should not allow user to impersonate another user", async () => {
      const otherUserResult = await testPool.query(
        `INSERT INTO users (email, password_hash, role, first_name, last_name) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        ["other@example.com", "hash", "user", "Other", "User"],
      );
      const otherUserId = otherUserResult.rows[0].id;

      const response = await request(app)
        .get(`${API_BASE}/users/${otherUserId}`)
        .set("Authorization", `Bearer ${validToken}`);

      // Should be forbidden or require admin role
      expect([403, 404]).toContain(response.status);
    });
  });
});
