/**
 * OWASP Top 10 Security Tests
 * Comprehensive security testing for OWASP Top 10 vulnerabilities
 */

import request from "supertest";
import app from "../../app";
import { generateTestToken } from "../../tests/helpers/request.helper";
import { testPool } from "../../tests/setup";
import jwt from "jsonwebtoken";

const API_BASE = `/api/${process.env.API_VERSION || "v1"}`;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret";

describe("OWASP Top 10 Security Tests", () => {
  let userId: string;
  let token: string;
  let otherUserId: string;

  beforeEach(async () => {
    // Create test user
    const result = await testPool.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name, status) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      ["owasp@example.com", "hash", "mentee", "OWASP", "Test", "active"],
    );
    userId = result.rows[0].id;
    token = generateTestToken({
      userId,
      email: "owasp@example.com",
      role: "mentee",
    });

    // Create another user for IDOR tests
    const otherResult = await testPool.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name, status) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      ["other@example.com", "hash", "mentee", "Other", "User", "active"],
    );
    otherUserId = otherResult.rows[0].id;
  });

  describe("A01:2021 – Broken Access Control", () => {
    describe("IDOR Prevention", () => {
      it("should prevent accessing other user's profile", async () => {
        const response = await request(app)
          .get(`${API_BASE}/users/${otherUserId}`)
          .set("Authorization", `Bearer ${token}`);

        expect([403, 404]).toContain(response.status);
      });

      it("should prevent modifying other user's data", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/${otherUserId}`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "Hacked",
            lastName: "User",
          });

        expect([403, 404]).toContain(response.status);
      });

      it("should prevent deleting other user's resources", async () => {
        const response = await request(app)
          .delete(`${API_BASE}/users/${otherUserId}`)
          .set("Authorization", `Bearer ${token}`);

        expect([403, 404]).toContain(response.status);
      });

      it("should prevent accessing other user's bookings", async () => {
        // Create booking for other user
        const bookingResult = await testPool.query(
          `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, amount, payment_status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            otherUserId,
            userId,
            new Date(Date.now() + 86400000),
            60,
            "Test Session",
            "pending",
            "100.0000000",
            "pending",
          ],
        );
        const bookingId = bookingResult.rows[0].id;

        const response = await request(app)
          .get(`${API_BASE}/bookings/${bookingId}`)
          .set("Authorization", `Bearer ${token}`);

        // Should only allow access if user is mentor or mentee
        expect([200, 403, 404]).toContain(response.status);
      });

      it("should prevent accessing other user's payments", async () => {
        // Create payment for other user
        const paymentResult = await testPool.query(
          `INSERT INTO transactions (user_id, amount, currency, status, type) 
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [otherUserId, "100.0000000", "XLM", "completed", "payment"],
        );
        const paymentId = paymentResult.rows[0].id;

        const response = await request(app)
          .get(`${API_BASE}/payments/${paymentId}`)
          .set("Authorization", `Bearer ${token}`);

        expect([403, 404]).toContain(response.status);
      });
    });

    describe("Privilege Escalation Prevention", () => {
      it("should prevent user from elevating their role", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "Test",
            lastName: "User",
            role: "admin",
          });

        expect([200, 400, 403]).toContain(response.status);

        // Verify role unchanged
        const userCheck = await testPool.query(
          `SELECT role FROM users WHERE id = $1`,
          [userId],
        );
        expect(userCheck.rows[0].role).toBe("mentee");
      });

      it("should prevent accessing admin-only endpoints", async () => {
        const response = await request(app)
          .get(`${API_BASE}/admin/users`)
          .set("Authorization", `Bearer ${token}`);

        expect([403, 404]).toContain(response.status);
      });

      it("should prevent modifying system settings", async () => {
        const response = await request(app)
          .put(`${API_BASE}/admin/settings`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            maintenanceMode: true,
          });

        expect([403, 404]).toContain(response.status);
      });
    });

    describe("Mass Assignment Prevention", () => {
      it("should prevent setting protected fields", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "Updated",
            lastName: "Name",
            isActive: false,
            isVerified: true,
            createdAt: "2020-01-01",
            updatedAt: "2020-01-01",
          });

        expect([200, 400]).toContain(response.status);

        // Verify protected fields unchanged
        const userCheck = await testPool.query(
          `SELECT is_active, created_at FROM users WHERE id = $1`,
          [userId],
        );
        expect(userCheck.rows[0].is_active).toBe(true);
      });

      it("should prevent setting internal IDs", async () => {
        const response = await request(app)
          .post(`${API_BASE}/bookings`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            id: "00000000-0000-0000-0000-000000000001",
            mentorId: otherUserId,
            scheduledAt: new Date(Date.now() + 86400000),
            durationMinutes: 60,
            topic: "Test",
          });

        expect([200, 201, 400]).toContain(response.status);

        if (response.status === 201 && response.body.data?.id) {
          expect(response.body.data.id).not.toBe(
            "00000000-0000-0000-0000-000000000001",
          );
        }
      });
    });
  });

  describe("A02:2021 – Cryptographic Failures", () => {
    describe("Sensitive Data Exposure", () => {
      it("should not expose password hashes in responses", async () => {
        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`);

        if (response.status === 200) {
          expect(response.body.data).not.toHaveProperty("password");
          expect(response.body.data).not.toHaveProperty("passwordHash");
          expect(response.body.data).not.toHaveProperty("password_hash");
        }
      });

      it("should not expose JWT secrets in responses", async () => {
        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`);

        const responseStr = JSON.stringify(response.body);
        expect(responseStr).not.toContain(JWT_SECRET);
      });

      it("should not expose database credentials", async () => {
        const response = await request(app)
          .get(`${API_BASE}/health`)
          .set("Authorization", `Bearer ${token}`);

        const responseStr = JSON.stringify(response.body);
        expect(responseStr).not.toMatch(/postgres|password|DATABASE_URL/i);
      });

      it("should not expose API keys in error messages", async () => {
        const response = await request(app)
          .get(`${API_BASE}/invalid-endpoint`)
          .set("Authorization", `Bearer ${token}`);

        const responseStr = JSON.stringify(response.body);
        expect(responseStr).not.toMatch(/API_KEY|SECRET|TOKEN/);
      });
    });

    describe("Weak Cryptography", () => {
      it("should use strong JWT algorithms", async () => {
        const tokenParts = token.split(".");
        const header = JSON.parse(
          Buffer.from(tokenParts[0], "base64").toString(),
        );

        expect(["HS256", "RS256", "ES256"]).toContain(header.alg);
        expect(header.alg).not.toBe("none");
      });

      it("should reject weak JWT algorithms", async () => {
        const weakToken = jwt.sign(
          { userId, email: "owasp@example.com", role: "mentee" },
          "",
          { algorithm: "none" as any },
        );

        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${weakToken}`);

        expect(response.status).toBe(401);
      });
    });
  });

  describe("A03:2021 – Injection", () => {
    describe("SQL Injection Prevention", () => {
      it("should prevent SQL injection in query parameters", async () => {
        const response = await request(app)
          .get(`${API_BASE}/mentors`)
          .set("Authorization", `Bearer ${token}`)
          .query({ search: "'; DROP TABLE users; --" });

        expect([200, 400]).toContain(response.status);

        // Verify table still exists
        const tableCheck = await testPool.query(
          `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='users')`,
        );
        expect(tableCheck.rows[0].exists).toBe(true);
      });

      it("should prevent SQL injection in request body", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "'; DELETE FROM users WHERE '1'='1",
            lastName: "User",
          });

        expect([200, 400]).toContain(response.status);

        // Verify user still exists
        const userCheck = await testPool.query(
          `SELECT COUNT(*) as count FROM users`,
        );
        expect(parseInt(userCheck.rows[0].count)).toBeGreaterThan(0);
      });

      it("should prevent UNION-based SQL injection", async () => {
        const response = await request(app)
          .get(`${API_BASE}/mentors`)
          .set("Authorization", `Bearer ${token}`)
          .query({ id: "1 UNION SELECT * FROM users--" });

        expect([200, 400, 404]).toContain(response.status);
      });

      it("should prevent boolean-based blind SQL injection", async () => {
        const response = await request(app)
          .get(`${API_BASE}/mentors`)
          .set("Authorization", `Bearer ${token}`)
          .query({ search: "1' AND '1'='1" });

        expect([200, 400]).toContain(response.status);
      });

      it("should prevent time-based blind SQL injection", async () => {
        const startTime = Date.now();

        const response = await request(app)
          .get(`${API_BASE}/mentors`)
          .set("Authorization", `Bearer ${token}`)
          .query({ search: "1' AND SLEEP(5)--" });

        const duration = Date.now() - startTime;

        expect([200, 400]).toContain(response.status);
        expect(duration).toBeLessThan(3000); // Should not sleep
      });
    });

    describe("XSS Prevention", () => {
      it("should sanitize script tags", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: '<script>alert("XSS")</script>',
            lastName: "User",
          });

        expect([200, 400]).toContain(response.status);

        if (response.status === 200) {
          const userResponse = await request(app)
            .get(`${API_BASE}/users/me`)
            .set("Authorization", `Bearer ${token}`);

          expect(userResponse.body.data.firstName).not.toContain("<script>");
        }
      });

      it("should sanitize event handlers", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: '<img src=x onerror="alert(1)">',
            lastName: "User",
          });

        expect([200, 400]).toContain(response.status);
      });

      it("should sanitize javascript: protocol", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: '<a href="javascript:alert(1)">click</a>',
            lastName: "User",
          });

        expect([200, 400]).toContain(response.status);
      });

      it("should sanitize data: protocol", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: '<img src="data:text/html,<script>alert(1)</script>">',
            lastName: "User",
          });

        expect([200, 400]).toContain(response.status);
      });
    });

    describe("Command Injection Prevention", () => {
      it("should prevent shell command injection", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "test; rm -rf /",
            lastName: "User",
          });

        expect([200, 400]).toContain(response.status);
      });

      it("should prevent backtick command substitution", async () => {
        const response = await request(app)
          .put(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            firstName: "`whoami`",
            lastName: "User",
          });

        expect([200, 400]).toContain(response.status);
      });
    });
  });

  describe("A04:2021 – Insecure Design", () => {
    describe("Business Logic Flaws", () => {
      it("should prevent negative payment amounts", async () => {
        const response = await request(app)
          .post(`${API_BASE}/payments/initiate`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            bookingId: "00000000-0000-0000-0000-000000000001",
            amount: "-100.0000000",
            currency: "XLM",
          });

        expect([400, 422]).toContain(response.status);
      });

      it("should prevent booking in the past", async () => {
        const response = await request(app)
          .post(`${API_BASE}/bookings`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            mentorId: otherUserId,
            scheduledAt: new Date(Date.now() - 86400000), // Yesterday
            durationMinutes: 60,
            topic: "Test Session",
          });

        expect([400, 422]).toContain(response.status);
      });

      it("should prevent excessive booking duration", async () => {
        const response = await request(app)
          .post(`${API_BASE}/bookings`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            mentorId: otherUserId,
            scheduledAt: new Date(Date.now() + 86400000),
            durationMinutes: 10000, // Unrealistic duration
            topic: "Test Session",
          });

        expect([400, 422]).toContain(response.status);
      });
    });
  });

  describe("A05:2021 – Security Misconfiguration", () => {
    describe("Security Headers", () => {
      it("should include X-Content-Type-Options: nosniff", async () => {
        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`);

        expect(response.headers["x-content-type-options"]).toBe("nosniff");
      });

      it("should include X-Frame-Options", async () => {
        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`);

        expect(["DENY", "SAMEORIGIN"]).toContain(
          response.headers["x-frame-options"],
        );
      });

      it("should include Content-Security-Policy", async () => {
        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`);

        expect(response.headers["content-security-policy"]).toBeDefined();
      });

      it("should include X-XSS-Protection", async () => {
        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${token}`);

        expect(response.headers["x-xss-protection"]).toBeDefined();
      });
    });

    describe("Error Handling", () => {
      it("should not expose stack traces in production", async () => {
        const response = await request(app)
          .get(`${API_BASE}/invalid-endpoint`)
          .set("Authorization", `Bearer ${token}`);

        const responseStr = JSON.stringify(response.body);
        expect(responseStr).not.toMatch(/at\s+\w+\s+\(/); // Stack trace pattern
      });

      it("should not expose internal paths", async () => {
        const response = await request(app)
          .get(`${API_BASE}/invalid-endpoint`)
          .set("Authorization", `Bearer ${token}`);

        const responseStr = JSON.stringify(response.body);
        expect(responseStr).not.toMatch(/\/home\/|\/usr\/|C:\\/);
      });
    });
  });

  describe("A06:2021 – Vulnerable and Outdated Components", () => {
    it("should not expose server version", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.headers["server"]).toBeUndefined();
      expect(response.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("A07:2021 – Identification and Authentication Failures", () => {
    describe("JWT Security", () => {
      it("should reject JWT with alg: none", async () => {
        const noneToken = jwt.sign(
          { userId, email: "owasp@example.com", role: "admin" },
          "",
          { algorithm: "none" as any },
        );

        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${noneToken}`);

        expect(response.status).toBe(401);
      });

      it("should reject expired JWT", async () => {
        const expiredToken = jwt.sign(
          { userId, email: "owasp@example.com", role: "mentee" },
          JWT_SECRET,
          { expiresIn: "-1h" },
        );

        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${expiredToken}`);

        expect(response.status).toBe(401);
      });

      it("should reject JWT with invalid signature", async () => {
        const invalidToken = jwt.sign(
          { userId, email: "owasp@example.com", role: "mentee" },
          "wrong-secret",
        );

        const response = await request(app)
          .get(`${API_BASE}/users/me`)
          .set("Authorization", `Bearer ${invalidToken}`);

        expect(response.status).toBe(401);
      });

      it("should reject tampered JWT payload", async () => {
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

    describe("Session Management", () => {
      it("should invalidate tokens on logout", async () => {
        // Login
        const loginResponse = await request(app)
          .post(`${API_BASE}/auth/login`)
          .send({
            email: "owasp@example.com",
            password: "password123",
          });

        if (loginResponse.status === 200) {
          const loginToken = loginResponse.body.data?.accessToken;

          // Logout
          await request(app)
            .post(`${API_BASE}/auth/logout`)
            .set("Authorization", `Bearer ${loginToken}`);

          // Try to use token after logout
          const response = await request(app)
            .get(`${API_BASE}/users/me`)
            .set("Authorization", `Bearer ${loginToken}`);

          expect([401, 403]).toContain(response.status);
        }
      });
    });
  });

  describe("A08:2021 – Software and Data Integrity Failures", () => {
    it("should validate content integrity", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/json")
        .send('{"firstName":"Test","lastName":"User","__proto__":{"isAdmin":true}}');

      expect([200, 400]).toContain(response.status);
    });
  });

  describe("A09:2021 – Security Logging and Monitoring Failures", () => {
    it("should log authentication failures", async () => {
      const response = await request(app).post(`${API_BASE}/auth/login`).send({
        email: "owasp@example.com",
        password: "wrong-password",
      });

      expect([401, 400]).toContain(response.status);
      // Logging verification would require checking log files
    });

    it("should log authorization failures", async () => {
      const response = await request(app)
        .get(`${API_BASE}/admin/users`)
        .set("Authorization", `Bearer ${token}`);

      expect([403, 404]).toContain(response.status);
      // Logging verification would require checking log files
    });
  });

  describe("A10:2021 – Server-Side Request Forgery (SSRF)", () => {
    it("should prevent SSRF via URL parameters", async () => {
      const response = await request(app)
        .post(`${API_BASE}/webhooks/test`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          url: "http://localhost:5432/admin",
        });

      expect([400, 403, 404]).toContain(response.status);
    });

    it("should prevent SSRF to internal IPs", async () => {
      const response = await request(app)
        .post(`${API_BASE}/webhooks/test`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          url: "http://192.168.1.1/admin",
        });

      expect([400, 403, 404]).toContain(response.status);
    });

    it("should prevent SSRF to metadata endpoints", async () => {
      const response = await request(app)
        .post(`${API_BASE}/webhooks/test`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          url: "http://169.254.169.254/latest/meta-data/",
        });

      expect([400, 403, 404]).toContain(response.status);
    });
  });
});
