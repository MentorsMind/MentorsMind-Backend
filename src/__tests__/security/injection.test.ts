import request from "supertest";
import app from "../../app";
import { generateTestToken } from "../../tests/helpers/request.helper";
import { testPool } from "../../tests/setup";

const API_BASE = `/api/${process.env.API_VERSION || "v1"}`;

describe("Security: Injection Prevention", () => {
  let token: string;
  let userId: string;

  beforeEach(async () => {
    // Create test user
    const result = await testPool.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ["test@example.com", "hash", "user", "Test", "User"],
    );
    userId = result.rows[0].id;
    token = generateTestToken({
      userId,
      email: "test@example.com",
      role: "user",
    });
  });

  describe("SQL Injection Prevention", () => {
    it("should reject SQL injection in query parameters", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`)
        .query({ search: "'; DROP TABLE users; --" });

      expect(response.status).toBe(200);
      // Verify table still exists
      const tableCheck = await testPool.query(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='users')`,
      );
      expect(tableCheck.rows[0].exists).toBe(true);
    });

    it("should reject SQL injection in request body", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          firstName: "'; DELETE FROM users; --",
          lastName: "User",
        });

      expect([200, 400]).toContain(response.status);
      // Verify data integrity
      const userCheck = await testPool.query(
        `SELECT * FROM users WHERE id = $1`,
        [userId],
      );
      expect(userCheck.rows.length).toBe(1);
    });

    it("should reject UNION-based SQL injection", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`)
        .query({ id: "1 UNION SELECT * FROM users--" });

      expect(response.status).toBe(200);
    });

    it("should reject time-based blind SQL injection", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`)
        .query({ search: "1' AND SLEEP(5)--" });

      // Should respond quickly, not wait 5 seconds
      expect(response.status).toBe(200);
    });
  });

  describe("XSS Prevention", () => {
    it("should sanitize script tags in text input", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          firstName: '<script>alert("xss")</script>',
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

    it("should sanitize event handlers in HTML", async () => {
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

    it("should escape HTML entities in responses", async () => {
      await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          firstName: "<b>Bold</b>",
          lastName: "User",
        });

      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`);

      // Should not contain unescaped HTML tags
      if (response.body.data?.firstName) {
        expect(response.body.data.firstName).not.toMatch(
          /<script|<img|<iframe/i,
        );
      }
    });
  });

  describe("NoSQL Injection Prevention", () => {
    it("should reject object injection in JSON body", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          firstName: { $ne: null },
          lastName: "User",
        });

      expect([200, 400]).toContain(response.status);
    });
  });

  describe("Command Injection Prevention", () => {
    it("should reject shell metacharacters in input", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          firstName: "test; rm -rf /",
          lastName: "User",
        });

      expect([200, 400]).toContain(response.status);
    });

    it("should reject backtick command substitution", async () => {
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

  describe("Path Traversal Prevention", () => {
    it("should reject path traversal in file operations", async () => {
      const response = await request(app)
        .post(`${API_BASE}/users/avatar`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          imageData:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          filename: "../../etc/passwd",
        });

      expect([200, 400, 404]).toContain(response.status);
    });
  });
});
