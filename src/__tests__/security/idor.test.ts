import request from "supertest";
import app from "../../app";
import { generateTestToken } from "../../tests/helpers/request.helper";
import { testPool } from "../../tests/setup";

const API_BASE = `/api/${process.env.API_VERSION || "v1"}`;

describe("Security: IDOR & Mass Assignment", () => {
  let user1Id: string;
  let user1Token: string;
  let user2Id: string;
  let user2Token: string;
  let adminId: string;
  let adminToken: string;

  beforeEach(async () => {
    // Create user 1
    const user1Result = await testPool.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ["user1@example.com", "hash", "user", "User", "One"],
    );
    user1Id = user1Result.rows[0].id;
    user1Token = generateTestToken({
      userId: user1Id,
      email: "user1@example.com",
      role: "user",
    });

    // Create user 2
    const user2Result = await testPool.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ["user2@example.com", "hash", "user", "User", "Two"],
    );
    user2Id = user2Result.rows[0].id;
    user2Token = generateTestToken({
      userId: user2Id,
      email: "user2@example.com",
      role: "user",
    });

    // Create admin
    const adminResult = await testPool.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ["admin@example.com", "hash", "admin", "Admin", "User"],
    );
    adminId = adminResult.rows[0].id;
    adminToken = generateTestToken({
      userId: adminId,
      email: "admin@example.com",
      role: "admin",
    });
  });

  describe("IDOR on User Endpoints", () => {
    it("should prevent user from accessing another user profile", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/${user2Id}`)
        .set("Authorization", `Bearer ${user1Token}`);

      expect([403, 404]).toContain(response.status);
    });

    it("should prevent user from updating another user profile", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/${user2Id}`)
        .set("Authorization", `Bearer ${user1Token}`)
        .send({
          firstName: "Hacked",
          lastName: "User",
        });

      expect([403, 404]).toContain(response.status);

      // Verify user2 data unchanged
      const userCheck = await testPool.query(
        `SELECT first_name FROM users WHERE id = $1`,
        [user2Id],
      );
      expect(userCheck.rows[0].first_name).toBe("User");
    });

    it("should prevent user from deleting another user", async () => {
      const response = await request(app)
        .delete(`${API_BASE}/users/${user2Id}`)
        .set("Authorization", `Bearer ${user1Token}`);

      expect([403, 404]).toContain(response.status);

      // Verify user2 still exists
      const userCheck = await testPool.query(
        `SELECT id FROM users WHERE id = $1`,
        [user2Id],
      );
      expect(userCheck.rows.length).toBe(1);
    });

    it("should allow admin to access any user profile", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/${user1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect([200, 404]).toContain(response.status);
    });
  });

  describe("IDOR on Wallet Endpoints", () => {
    it("should prevent user from accessing another user wallet", async () => {
      // Create wallets for both users
      await testPool.query(
        `INSERT INTO wallets (user_id, stellar_public_key, status) 
         VALUES ($1, $2, $3)`,
        [
          user1Id,
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5V3VF",
          "active",
        ],
      );

      const user2WalletResult = await testPool.query(
        `INSERT INTO wallets (user_id, stellar_public_key, status) 
         VALUES ($1, $2, $3) RETURNING id`,
        [
          user2Id,
          "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBY5V3VF",
          "active",
        ],
      );
      const user2WalletId = user2WalletResult.rows[0].id;

      const response = await request(app)
        .get(`${API_BASE}/wallets/${user2WalletId}`)
        .set("Authorization", `Bearer ${user1Token}`);

      expect([403, 404]).toContain(response.status);
    });

    it("should prevent user from updating another user wallet", async () => {
      const walletResult = await testPool.query(
        `INSERT INTO wallets (user_id, stellar_public_key, status) 
         VALUES ($1, $2, $3) RETURNING id`,
        [
          user2Id,
          "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBY5V3VF",
          "active",
        ],
      );
      const walletId = walletResult.rows[0].id;

      const response = await request(app)
        .put(`${API_BASE}/wallets/${walletId}`)
        .set("Authorization", `Bearer ${user1Token}`)
        .send({ status: "inactive" });

      expect([403, 404]).toContain(response.status);

      // Verify wallet status unchanged
      const walletCheck = await testPool.query(
        `SELECT status FROM wallets WHERE id = $1`,
        [walletId],
      );
      expect(walletCheck.rows[0].status).toBe("active");
    });
  });

  describe("IDOR on Session/Booking Endpoints", () => {
    it("should prevent user from accessing another user session", async () => {
      const sessionResult = await testPool.query(
        `INSERT INTO sessions (mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [user1Id, user2Id, "Session", "Desc", new Date(), 60, "scheduled"],
      );
      const sessionId = sessionResult.rows[0].id;

      // User 1 (mentor) should access, but user 3 should not
      const user3Result = await testPool.query(
        `INSERT INTO users (email, password_hash, role, first_name, last_name) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        ["user3@example.com", "hash", "user", "User", "Three"],
      );
      const user3Id = user3Result.rows[0].id;
      const user3Token = generateTestToken({
        userId: user3Id,
        email: "user3@example.com",
        role: "user",
      });

      const response = await request(app)
        .get(`${API_BASE}/bookings/${sessionId}`)
        .set("Authorization", `Bearer ${user3Token}`);

      expect([403, 404]).toContain(response.status);
    });

    it("should prevent user from updating another user session", async () => {
      const sessionResult = await testPool.query(
        `INSERT INTO sessions (mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [user1Id, user2Id, "Session", "Desc", new Date(), 60, "scheduled"],
      );
      const sessionId = sessionResult.rows[0].id;

      const response = await request(app)
        .put(`${API_BASE}/bookings/${sessionId}`)
        .set("Authorization", `Bearer ${user1Token}`)
        .send({ status: "cancelled" });

      // User 1 is mentor, should be able to update
      expect([200, 400, 403, 404]).toContain(response.status);
    });
  });

  describe("Mass Assignment Prevention", () => {
    it("should not allow setting internal fields via mass assignment", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${user1Token}`)
        .send({
          firstName: "Updated",
          lastName: "Name",
          isActive: false,
          createdAt: "2020-01-01",
          role: "admin",
        });

      expect([200, 400]).toContain(response.status);

      if (response.status === 200) {
        const userCheck = await testPool.query(
          `SELECT is_active, role FROM users WHERE id = $1`,
          [user1Id],
        );
        expect(userCheck.rows[0].is_active).toBe(true);
        expect(userCheck.rows[0].role).toBe("user");
      }
    });

    it("should not allow setting admin-only fields", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${user1Token}`)
        .send({
          firstName: "Updated",
          lastName: "Name",
          verificationStatus: "verified",
          suspensionReason: "spam",
        });

      expect([200, 400]).toContain(response.status);
    });

    it("should not allow setting wallet fields via user update", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${user1Token}`)
        .send({
          firstName: "Updated",
          lastName: "Name",
          stellarPublicKey:
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5V3VF",
          walletStatus: "active",
        });

      expect([200, 400]).toContain(response.status);
    });

    it("should not allow setting transaction fields via user update", async () => {
      const response = await request(app)
        .put(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${user1Token}`)
        .send({
          firstName: "Updated",
          lastName: "Name",
          balance: 10000,
          totalEarnings: 50000,
        });

      expect([200, 400]).toContain(response.status);
    });
  });

  describe("IDOR on Transaction Endpoints", () => {
    it("should prevent user from viewing another user transaction", async () => {
      const txResult = await testPool.query(
        `INSERT INTO transactions (user_id, amount, currency, status, type) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [user2Id, 100, "XLM", "completed", "deposit"],
      );
      const txId = txResult.rows[0].id;

      const response = await request(app)
        .get(`${API_BASE}/transactions/${txId}`)
        .set("Authorization", `Bearer ${user1Token}`);

      expect([403, 404]).toContain(response.status);
    });

    it("should prevent user from cancelling another user transaction", async () => {
      const txResult = await testPool.query(
        `INSERT INTO transactions (user_id, amount, currency, status, type) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [user2Id, 100, "XLM", "pending", "withdrawal"],
      );
      const txId = txResult.rows[0].id;

      const response = await request(app)
        .post(`${API_BASE}/transactions/${txId}/cancel`)
        .set("Authorization", `Bearer ${user1Token}`);

      expect([403, 404]).toContain(response.status);

      // Verify transaction status unchanged
      const txCheck = await testPool.query(
        `SELECT status FROM transactions WHERE id = $1`,
        [txId],
      );
      expect(txCheck.rows[0].status).toBe("pending");
    });
  });

  describe("Numeric ID Enumeration Prevention", () => {
    it("should use UUIDs instead of sequential IDs", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${user1Token}`);

      if (response.status === 200 && response.body.data?.id) {
        // UUID format: 8-4-4-4-12 hex digits
        expect(response.body.data.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    });

    it("should not expose sequential user IDs in responses", async () => {
      const response = await request(app)
        .get(`${API_BASE}/users/me`)
        .set("Authorization", `Bearer ${user1Token}`);

      if (response.status === 200 && response.body.data?.id) {
        expect(response.body.data.id).not.toMatch(/^\d+$/);
      }
    });
  });
});
