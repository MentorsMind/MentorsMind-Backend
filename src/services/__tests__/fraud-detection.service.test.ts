import { FraudDetectionService } from "../fraud-detection.service";
import pool from "../../config/database";

/**
 * Fraud Detection Service Tests
 * Validates that fraud detection blocks ≥95% of synthetic abuse cases
 */

describe("FraudDetectionService", () => {
  describe("checkReferralFraud", () => {
    beforeEach(async () => {
      // Setup test data
      await pool.query("BEGIN");
    });

    afterEach(async () => {
      await pool.query("ROLLBACK");
    });

    it("should block self-referral (same user ID)", async () => {
      const result = await FraudDetectionService.checkReferralFraud({
        referrerId: "user-123",
        refereeId: "user-123",
        refereeEmail: "test@example.com",
      });

      expect(result.isValid).toBe(false);
      expect(result.fraudFlags).toContain("self_referral");
      expect(result.riskScore).toBeGreaterThanOrEqual(100);
    });

    it("should block referral with same IP address", async () => {
      // Mock setup: referrer has logged in from 192.168.1.1
      const referrerId = "referrer-456";
      const refereeId = "referee-789";
      const sharedIp = "192.168.1.1";

      await pool.query(
        `INSERT INTO audit_logs (user_id, action, ip_address, created_at)
         VALUES ($1, 'user:login', $2, NOW())`,
        [referrerId, sharedIp]
      );

      const result = await FraudDetectionService.checkReferralFraud({
        referrerId,
        refereeId,
        refereeEmail: "referee@example.com",
        refereeIp: sharedIp,
      });

      expect(result.isValid).toBe(false);
      expect(result.fraudFlags).toContain("same_ip");
      expect(result.riskScore).toBeGreaterThanOrEqual(60);
    });

    it("should block referral with same device fingerprint", async () => {
      const referrerId = "referrer-abc";
      const refereeId = "referee-def";
      const deviceFingerprint = "fp-12345678";

      await pool.query(
        `INSERT INTO audit_logs (user_id, action, metadata, created_at)
         VALUES ($1, 'user:login', $2, NOW())`,
        [referrerId, JSON.stringify({ device_fingerprint: deviceFingerprint })]
      );

      const result = await FraudDetectionService.checkReferralFraud({
        referrerId,
        refereeId,
        refereeEmail: "referee@example.com",
        refereeDeviceFingerprint: deviceFingerprint,
      });

      expect(result.isValid).toBe(false);
      expect(result.fraudFlags).toContain("same_device");
      expect(result.riskScore).toBeGreaterThanOrEqual(50);
    });

    it("should block accounts created within 60 seconds", async () => {
      const referrerId = "referrer-ghi";
      const refereeId = "referee-jkl";

      // Create referrer account
      const referrerCreatedAt = new Date();
      await pool.query(
        "INSERT INTO users (id, email, created_at) VALUES ($1, $2, $3)",
        [referrerId, "referrer@example.com", referrerCreatedAt]
      );

      // Create referee account 30 seconds later
      const refereeCreatedAt = new Date(referrerCreatedAt.getTime() + 30000);

      const result = await FraudDetectionService.checkReferralFraud({
        referrerId,
        refereeId,
        refereeEmail: "referee@example.com",
        refereeCreatedAt,
      });

      expect(result.isValid).toBe(false);
      expect(result.fraudFlags).toContain("rapid_creation");
      expect(result.riskScore).toBeGreaterThanOrEqual(40);
    });

    it("should detect suspicious email pattern (user+1@example.com)", async () => {
      const referrerId = "referrer-mno";
      const refereeId = "referee-pqr";

      await pool.query(
        "INSERT INTO users (id, email) VALUES ($1, $2)",
        [referrerId, "user@example.com"]
      );

      const result = await FraudDetectionService.checkReferralFraud({
        referrerId,
        refereeId,
        refereeEmail: "user+1@example.com",
      });

      expect(result.isValid).toBe(false);
      expect(result.fraudFlags).toContain("suspicious_email_pattern");
      expect(result.riskScore).toBeGreaterThanOrEqual(30);
    });

    it("should block high velocity referrals (>10 in 24 hours)", async () => {
      const referrerId = "referrer-stu";
      const refereeId = "referee-vwx";

      // Create 11 recent referral events
      for (let i = 0; i < 11; i++) {
        await pool.query(
          `INSERT INTO referral_events (event_type, referrer_id, referee_id, referral_code, created_at)
           VALUES ('code_applied', $1, $2, 'CODE123', NOW() - INTERVAL '1 hour')`,
          [referrerId, `referee-${i}`]
        );
      }

      const result = await FraudDetectionService.checkReferralFraud({
        referrerId,
        refereeId,
        refereeEmail: "referee@example.com",
      });

      expect(result.isValid).toBe(false);
      expect(result.fraudFlags).toContain("high_velocity");
      expect(result.riskScore).toBeGreaterThanOrEqual(25);
    });

    it("should block disposable email addresses", async () => {
      const result = await FraudDetectionService.checkReferralFraud({
        referrerId: "referrer-yz",
        refereeId: "referee-aa",
        refereeEmail: "fake@tempmail.com",
      });

      expect(result.isValid).toBe(false);
      expect(result.fraudFlags).toContain("disposable_email");
      expect(result.riskScore).toBeGreaterThanOrEqual(20);
    });

    it("should block IP abuse (>5 accounts from same IP)", async () => {
      const sharedIp = "203.0.113.1";
      const referrerId = "referrer-bb";
      const refereeId = "referee-cc";

      // Create 6 referral events from same IP
      for (let i = 0; i < 6; i++) {
        await pool.query(
          `INSERT INTO referral_events (event_type, referrer_id, referee_id, referral_code, metadata, created_at)
           VALUES ('code_applied', $1, $2, 'CODE456', $3, NOW() - INTERVAL '1 day')`,
          [`ref-${i}`, `referee-ip-${i}`, JSON.stringify({ referee_ip: sharedIp })]
        );
      }

      const result = await FraudDetectionService.checkReferralFraud({
        referrerId,
        refereeId,
        refereeEmail: "referee@example.com",
        refereeIp: sharedIp,
      });

      expect(result.isValid).toBe(false);
      expect(result.fraudFlags).toContain("ip_abuse");
      expect(result.riskScore).toBeGreaterThanOrEqual(35);
    });

    it("should allow legitimate referral", async () => {
      const referrerId = "legit-referrer";
      const refereeId = "legit-referee";

      await pool.query(
        "INSERT INTO users (id, email, created_at) VALUES ($1, $2, $3)",
        [referrerId, "referrer@company.com", new Date("2026-01-01")]
      );

      const result = await FraudDetectionService.checkReferralFraud({
        referrerId,
        refereeId,
        refereeEmail: "referee@different-company.com",
        refereeIp: "198.51.100.1",
        refereeDeviceFingerprint: "unique-fp-9876",
        refereeCreatedAt: new Date("2026-07-20"),
      });

      expect(result.isValid).toBe(true);
      expect(result.fraudFlags.length).toBe(0);
      expect(result.riskScore).toBeLessThan(70);
    });

    it("should handle multiple fraud indicators", async () => {
      const referrerId = "multi-fraud-referrer";
      const refereeId = "multi-fraud-referee";
      const sharedIp = "192.0.2.1";
      const deviceFingerprint = "shared-device-123";

      // Setup: referrer has same IP and device
      await pool.query(
        "INSERT INTO users (id, email, created_at) VALUES ($1, $2, $3)",
        [referrerId, "user@example.com", new Date()]
      );

      await pool.query(
        `INSERT INTO audit_logs (user_id, action, ip_address, metadata, created_at)
         VALUES ($1, 'user:login', $2, $3, NOW())`,
        [
          referrerId,
          sharedIp,
          JSON.stringify({ device_fingerprint: deviceFingerprint }),
        ]
      );

      const result = await FraudDetectionService.checkReferralFraud({
        referrerId,
        refereeId,
        refereeEmail: "user+1@example.com", // Suspicious pattern
        refereeIp: sharedIp, // Same IP
        refereeDeviceFingerprint: deviceFingerprint, // Same device
        refereeCreatedAt: new Date(), // Rapid creation
      });

      expect(result.isValid).toBe(false);
      expect(result.fraudFlags.length).toBeGreaterThan(2);
      expect(result.fraudFlags).toEqual(
        expect.arrayContaining([
          "same_ip",
          "same_device",
          "rapid_creation",
          "suspicious_email_pattern",
        ])
      );
      expect(result.riskScore).toBeGreaterThan(100);
    });
  });

  describe("Fraud Detection Rate Target", () => {
    it("should achieve ≥95% detection rate on test scenarios", async () => {
      const testScenarios = [
        {
          name: "Self-referral",
          setup: async () => ({
            referrerId: "user-1",
            refereeId: "user-1",
            refereeEmail: "test@example.com",
          }),
        },
        {
          name: "Same IP",
          setup: async () => {
            await pool.query(
              `INSERT INTO audit_logs (user_id, action, ip_address, created_at)
               VALUES ('ref-2', 'user:login', '10.0.0.1', NOW())`
            );
            return {
              referrerId: "ref-2",
              refereeId: "ree-2",
              refereeEmail: "test2@example.com",
              refereeIp: "10.0.0.1",
            };
          },
        },
        {
          name: "Disposable email",
          setup: async () => ({
            referrerId: "ref-3",
            refereeId: "ree-3",
            refereeEmail: "test@guerrillamail.com",
          }),
        },
        // Add more scenarios...
      ];

      let blocked = 0;
      for (const scenario of testScenarios) {
        await pool.query("BEGIN");
        const context = await scenario.setup();
        const result = await FraudDetectionService.checkReferralFraud(context);
        if (!result.isValid) blocked++;
        await pool.query("ROLLBACK");
      }

      const detectionRate = (blocked / testScenarios.length) * 100;
      expect(detectionRate).toBeGreaterThanOrEqual(95);
    });
  });
});
