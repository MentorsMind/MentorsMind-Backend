/**
 * Key Management Service
 *
 * High-level key lifecycle management layer that:
 *   1. Integrates the HSM service with the application's encryption layer
 *   2. Manages named key purposes (PII, API keys, webhook secrets, etc.)
 *   3. Bridges existing EncryptionUtil key versioning with HSM key metadata
 *   4. Drives key rotation scheduling (called by the keyRotation.job)
 *   5. Exposes a unified API for all cryptographic key operations
 *
 * Architecture decision:
 *   Rather than replacing EncryptionUtil (which is used across the codebase),
 *   this service adds an HSM-backed key management layer on top of it.
 *   EncryptionUtil continues to handle field-level PII encryption while
 *   this service controls the lifecycle of the keys it uses.
 *
 * Key purposes managed:
 *   - pii              : AES-256 key for PII field encryption
 *   - api-keys         : AES-256 key for API key storage
 *   - webhook-secrets  : AES-256 key for webhook secret storage
 *   - oauth-tokens     : AES-256 key for OAuth token storage
 *   - jwt-signing      : RSA-3072 or EC-P384 key for JWT signing (JWKS)
 *   - document-signing : EC-P521 key for verifiable credential signing
 *   - backup           : AES-256 wrapping key for backup encryption
 */

import { v4 as uuidv4 } from "uuid";
import pool from "../config/database";
import { redis } from "../config/redis";
import { logger } from "../utils/logger.utils";
import { EncryptionUtil, type EncryptionKeyset } from "../utils/encryption.utils";
import hsmService, { HsmService } from "./hsm.service";
import {
  type HsmKeyMetadata,
  type KeyPurpose,
  type KeyRotationResult,
  type ComplianceReport,
  type HsmEncryptResult,
  type HsmDecryptRequest,
} from "./hsm.service";
import { type SignatureResult } from "../utils/crypto-hsm.utils";
import hsmConfig from "../config/hsm.config";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Named purpose categories the key manager tracks */
export type ManagedKeyPurpose =
  | "pii"
  | "api-keys"
  | "webhook-secrets"
  | "oauth-tokens"
  | "jwt-signing"
  | "document-signing"
  | "backup"
  | "custom";

export interface ManagedKey {
  /** Internal HSM key ID */
  hsmKeyId: string;
  /** Human-readable version label (e.g. "v3") */
  version: string;
  /** Purpose category */
  purpose: ManagedKeyPurpose;
  /** Status */
  status: "active" | "rotating" | "deprecated" | "destroyed";
  /** When this version was created */
  createdAt: Date;
  /** When this version expires and should be rotated */
  expiresAt: Date;
  /** Previous version that may still be used for decryption */
  previousHsmKeyId?: string;
  previousVersion?: string;
}

export interface KeyRotationSummary {
  purpose: ManagedKeyPurpose;
  rotatedKeys: KeyRotationResult[];
  reEncryptedRecords: number;
  durationMs: number;
  errors: string[];
}

export interface KeyManagementStatus {
  provider: string;
  fipsEnabled: boolean;
  fipsLevel: number;
  managedPurposes: ManagedKeyPurpose[];
  activeKeyCount: number;
  keysPendingRotation: number;
  lastRotationAt: Date | null;
  escrowConfigured: boolean;
  complianceStatus: "COMPLIANT" | "REQUIRES_ATTENTION" | "NON_COMPLIANT";
}

// ─── Key Management Service ───────────────────────────────────────────────────

export class KeyManagementService {
  private readonly hsm: HsmService;
  /** purpose → ManagedKey (current active version) */
  private readonly managedKeys: Map<ManagedKeyPurpose, ManagedKey> = new Map();
  private lastRotationAt: Date | null = null;

  constructor(hsm: HsmService = hsmService) {
    this.hsm = hsm;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /**
   * Bootstrap the key management service.
   *
   * - Initialises the HSM service
   * - Ensures keys for all built-in purposes exist
   * - Wires EncryptionUtil to use HSM-managed PII keys
   */
  async initialize(): Promise<void> {
    logger.info("Initialising KeyManagementService");

    await this.hsm.initialize();
    await this.ensureAllPurposeKeysExist();
    this.wireEncryptionUtil();

    logger.info(
      { managedPurposes: Array.from(this.managedKeys.keys()) },
      "KeyManagementService initialised",
    );
  }

  /** Graceful shutdown. */
  async shutdown(): Promise<void> {
    await this.hsm.shutdown();
  }

  // ── Encryption / Decryption (direct HSM) ─────────────────────────────────────

  /**
   * Encrypt data under the active key for a given purpose.
   * Returns a portable encrypted payload that includes key reference metadata.
   */
  async encrypt(
    purpose: ManagedKeyPurpose,
    plaintext: string | Buffer,
    aad?: Buffer,
  ): Promise<HsmEncryptResult> {
    const managed = await this.requireManagedKey(purpose);
    return this.hsm.encrypt(managed.hsmKeyId, plaintext, aad);
  }

  /**
   * Decrypt an HsmEncryptResult.
   * Automatically resolves the correct key version for decryption.
   */
  async decrypt(req: HsmDecryptRequest): Promise<Buffer> {
    return this.hsm.decrypt(req);
  }

  /**
   * Convenience: encrypt a string to a JSON string payload that embeds
   * everything needed for later decryption. Safe to store in DB.
   */
  async encryptToString(purpose: ManagedKeyPurpose, plaintext: string): Promise<string> {
    const result = await this.encrypt(purpose, plaintext);
    return JSON.stringify(result);
  }

  /**
   * Convenience: decrypt a JSON-encoded HsmEncryptResult back to a string.
   */
  async decryptFromString(payload: string): Promise<string> {
    const req = JSON.parse(payload) as HsmDecryptRequest;
    const buf = await this.decrypt(req);
    return buf.toString("utf8");
  }

  // ── Signing ───────────────────────────────────────────────────────────────────

  /**
   * Sign data with the key for a given purpose (jwt-signing, document-signing).
   */
  async sign(purpose: ManagedKeyPurpose, data: Buffer | string): Promise<SignatureResult> {
    const managed = await this.requireManagedKey(purpose);
    return this.hsm.sign(managed.hsmKeyId, data);
  }

  /**
   * Verify a signature.
   */
  async verify(
    purpose: ManagedKeyPurpose,
    data: Buffer | string,
    signature: SignatureResult,
  ): Promise<boolean> {
    const managed = await this.requireManagedKey(purpose);
    return this.hsm.verify(managed.hsmKeyId, data, signature);
  }

  /**
   * Get the PEM-encoded public key for an asymmetric purpose (for JWKS, DID docs).
   */
  async getPublicKey(purpose: ManagedKeyPurpose): Promise<string> {
    const managed = await this.requireManagedKey(purpose);
    return this.hsm.getPublicKey(managed.hsmKeyId);
  }

  // ── Key Rotation ──────────────────────────────────────────────────────────────

  /**
   * Rotate the active key for a specific purpose.
   *
   * Steps:
   *   1. Create a new key version in the HSM
   *   2. Update managed key registry
   *   3. Re-encrypt any data encrypted with the previous version
   *      (optional, depends on purpose)
   *
   * @param purpose - Which purpose's key to rotate
   * @param reEncrypt - Whether to re-encrypt existing records with the new key
   */
  async rotatePurposeKey(
    purpose: ManagedKeyPurpose,
    reEncrypt = false,
  ): Promise<KeyRotationSummary> {
    const start = Date.now();
    const errors: string[] = [];
    let reEncryptedRecords = 0;

    logger.info({ purpose }, "Starting key rotation for purpose");

    const managed = await this.requireManagedKey(purpose);
    let rotatedKeys: KeyRotationResult[] = [];

    try {
      const result = await this.hsm.rotateKey(managed.hsmKeyId, "manual");
      rotatedKeys.push(result);

      // Update the managed key registry
      const newManaged: ManagedKey = {
        ...managed,
        hsmKeyId: result.newKeyId,
        version: result.newVersion,
        status: "active",
        createdAt: result.rotatedAt,
        expiresAt: new Date(
          result.rotatedAt.getTime() +
            (purpose === "jwt-signing" || purpose === "document-signing"
              ? hsmConfig.rotation.asymmetricRotationDays
              : hsmConfig.rotation.symmetricRotationDays) *
              86_400_000,
        ),
        previousHsmKeyId: managed.hsmKeyId,
        previousVersion: managed.version,
      };
      this.managedKeys.set(purpose, newManaged);
      await this.persistManagedKey(newManaged);
      this.lastRotationAt = result.rotatedAt;

      // Re-encrypt purpose-specific data if requested
      if (reEncrypt) {
        try {
          reEncryptedRecords = await this.reEncryptPurposeData(purpose, managed);
        } catch (err) {
          const msg = (err as Error).message;
          errors.push(`Re-encryption failed: ${msg}`);
          logger.error({ purpose, error: msg }, "Re-encryption during rotation failed");
        }
      }

      // Wire updated PII key into EncryptionUtil if needed
      if (purpose === "pii") {
        this.wireEncryptionUtil();
      }
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(msg);
      logger.error({ purpose, error: msg }, "Key rotation failed");
    }

    const summary: KeyRotationSummary = {
      purpose,
      rotatedKeys,
      reEncryptedRecords,
      durationMs: Date.now() - start,
      errors,
    };

    logger.info(
      { purpose, rotatedCount: rotatedKeys.length, reEncryptedRecords, errors: errors.length },
      "Key rotation complete",
    );

    return summary;
  }

  /**
   * Run scheduled rotation for all purposes whose keys are expiring.
   * This is called by keyRotation.job.ts on its cron schedule.
   */
  async runScheduledRotation(): Promise<KeyRotationSummary[]> {
    const summaries: KeyRotationSummary[] = [];
    const now = Date.now();
    const lookaheadMs = 7 * 86_400_000; // rotate if < 7 days remaining

    for (const entry of Array.from(this.managedKeys.entries())) {
      const [purpose, managed] = entry;
      if (
        managed.status === "active" &&
        managed.expiresAt.getTime() - now < lookaheadMs
      ) {
        const summary = await this.rotatePurposeKey(purpose, purpose === "pii");
        summaries.push(summary);
      }
    }

    // Also ask the HSM to rotate any low-level keys approaching expiry
    await this.hsm.rotateExpiredKeys();

    // Purge old versions past retention period
    await this.hsm.purgeExpiredVersions();

    logger.info({ summariesCount: summaries.length }, "Scheduled rotation sweep done");
    return summaries;
  }

  /**
   * Emergency rotation: immediately rotate all active keys.
   * Use when a key compromise is suspected.
   */
  async emergencyRotateAll(): Promise<KeyRotationSummary[]> {
    logger.warn("EMERGENCY KEY ROTATION triggered — rotating all active keys");

    const summaries: KeyRotationSummary[] = [];
    for (const purpose of Array.from(this.managedKeys.keys())) {
      const summary = await this.rotatePurposeKey(purpose, false);
      summaries.push(summary);
    }
    return summaries;
  }

  // ── Key Escrow ────────────────────────────────────────────────────────────────

  /**
   * Escrow all active keys for disaster recovery.
   * Returns the escrow share arrays — the caller MUST distribute
   * shares to custodians securely.
   */
  async escrowAllActiveKeys(): Promise<Record<ManagedKeyPurpose, string[]>> {
    const result: Record<string, string[]> = {};

    for (const entry of Array.from(this.managedKeys.entries())) {
      const [purpose, managed] = entry;
      if (managed.status !== "active") continue;
      try {
        const escrowResult = await this.hsm.escrowKey(managed.hsmKeyId);
        result[purpose] = escrowResult.shares;
        logger.info({ purpose, shareCount: escrowResult.shareCount }, "Key escrowed");
      } catch (err) {
        logger.error({ purpose, error: (err as Error).message }, "Escrow failed");
      }
    }

    return result as Record<ManagedKeyPurpose, string[]>;
  }

  // ── Compliance ────────────────────────────────────────────────────────────────

  /**
   * Generate a FIPS 140-2 compliance report.
   */
  async generateComplianceReport(from?: Date, to?: Date): Promise<ComplianceReport> {
    return this.hsm.generateComplianceReport(from, to);
  }

  /**
   * Get the current status of the key management service.
   */
  async getStatus(): Promise<KeyManagementStatus> {
    const report = await this.hsm.generateComplianceReport(
      new Date(Date.now() - 86_400_000),
      new Date(),
    );

    const pendingRotation = Array.from(this.managedKeys.values()).filter(
      (k) => k.expiresAt.getTime() - Date.now() < 30 * 86_400_000,
    ).length;

    return {
      provider: hsmConfig.provider,
      fipsEnabled: hsmConfig.enabled,
      fipsLevel: hsmConfig.compliance.fipsLevel,
      managedPurposes: Array.from(this.managedKeys.keys()),
      activeKeyCount: Array.from(this.managedKeys.values()).filter(
        (k) => k.status === "active",
      ).length,
      keysPendingRotation: pendingRotation,
      lastRotationAt: this.lastRotationAt,
      escrowConfigured: hsmConfig.escrow.store !== "none",
      complianceStatus: report.complianceStatus,
    };
  }

  /**
   * List all managed keys (metadata only — no key material).
   */
  async listManagedKeys(): Promise<ManagedKey[]> {
    return Array.from(this.managedKeys.values());
  }

  // ── EncryptionUtil Bridge ─────────────────────────────────────────────────────

  /**
   * Wire the existing EncryptionUtil to use HSM-managed PII keys.
   *
   * This method provides EncryptionUtil with a custom key resolver that
   * returns the current PII keyset from the HSM, ensuring all field-level
   * encryption uses HSM-managed keys without modifying EncryptionUtil itself.
   */
  wireEncryptionUtil(): void {
    const service = this;

    EncryptionUtil.setKeyResolver(async (): Promise<EncryptionKeyset> => {
      const managed = service.managedKeys.get("pii");
      if (!managed) {
        // Fall back to environment variable keyset if HSM not yet initialised
        const envKey = process.env.PII_ENCRYPTION_KEY;
        if (envKey) {
          return {
            currentVersion: process.env.PII_ENCRYPTION_CURRENT_KEY_VERSION ?? "v1",
            keys: {
              [process.env.PII_ENCRYPTION_CURRENT_KEY_VERSION ?? "v1"]: envKey,
            },
          };
        }
        throw new Error("PII encryption key not available — HSM not initialised");
      }

      // Derive a stable key material string from the HSM-managed key's fingerprint.
      // In production, the HSM service would expose raw key material only here.
      // We use HKDF to derive a 256-bit AES key deterministically.
      const { derivedKey } = await service.hsm.deriveKey(
        managed.hsmKeyId,
        "encryption",
        Buffer.from("PII-EncryptionUtil-Bridge", "utf8"),
        32,
      );

      const keys: Record<string, string> = {
        [managed.version]: derivedKey.toString("base64"),
      };

      // Include previous version for seamless rotation (in-flight decryption)
      if (managed.previousHsmKeyId && managed.previousVersion) {
        try {
          const { derivedKey: prevKey } = await service.hsm.deriveKey(
            managed.previousHsmKeyId,
            "encryption",
            Buffer.from("PII-EncryptionUtil-Bridge", "utf8"),
            32,
          );
          keys[managed.previousVersion] = prevKey.toString("base64");
        } catch {
          // Previous key may have been purged — ignore
        }
      }

      return {
        currentVersion: managed.version,
        keys,
      };
    });

    logger.debug("EncryptionUtil wired to HSM-managed PII keys");
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  /**
   * Ensure a key exists in the HSM for every built-in purpose.
   * Creates keys on first run; reloads from registry on subsequent runs.
   */
  private async ensureAllPurposeKeysExist(): Promise<void> {
    const symmetricPurposes: ManagedKeyPurpose[] = [
      "pii",
      "api-keys",
      "webhook-secrets",
      "oauth-tokens",
      "backup",
    ];

    for (const purpose of symmetricPurposes) {
      await this.ensurePurposeKeyExists(purpose, "symmetric");
    }

    // Asymmetric purposes
    await this.ensurePurposeKeyExists("jwt-signing", "asymmetric");
    await this.ensurePurposeKeyExists("document-signing", "asymmetric");
  }

  private async ensurePurposeKeyExists(
    purpose: ManagedKeyPurpose,
    type: "symmetric" | "asymmetric",
  ): Promise<void> {
    // Check if we already have it in memory
    if (this.managedKeys.has(purpose)) return;

    // Try to load from DB
    const existing = await this.loadManagedKey(purpose);
    if (existing) {
      this.managedKeys.set(purpose, existing);
      return;
    }

    // Generate a new key
    if (type === "symmetric") {
      const hsmKeyPurpose: KeyPurpose =
        purpose === "pii"
          ? "pii-encryption"
          : purpose === "backup"
          ? "backup-encryption"
          : "data-encryption";

      const meta = await this.hsm.generateSymmetricKey(
        `${purpose}-key`,
        hsmKeyPurpose,
        { managed_purpose: purpose },
      );

      const managed: ManagedKey = {
        hsmKeyId: meta.id,
        version: meta.version,
        purpose,
        status: "active",
        createdAt: meta.createdAt,
        expiresAt: meta.expiresAt,
      };
      this.managedKeys.set(purpose, managed);
      await this.persistManagedKey(managed);
    } else {
      // Generate EC key pair for signing purposes (EC P-384 for JWT, P-521 for docs)
      const curve =
        purpose === "document-signing" ? "P-521" : "P-384";

      const { privateKeyMeta } = await this.hsm.generateEcKeyPair(
        curve,
        `${purpose}-key`,
        "signing",
        { managed_purpose: purpose },
      );

      const managed: ManagedKey = {
        hsmKeyId: privateKeyMeta.id,
        version: privateKeyMeta.version,
        purpose,
        status: "active",
        createdAt: privateKeyMeta.createdAt,
        expiresAt: privateKeyMeta.expiresAt,
      };
      this.managedKeys.set(purpose, managed);
      await this.persistManagedKey(managed);
    }

    logger.info({ purpose, type }, "Created new managed key");
  }

  private async requireManagedKey(purpose: ManagedKeyPurpose): Promise<ManagedKey> {
    const managed = this.managedKeys.get(purpose);
    if (!managed) {
      throw new Error(
        `KeyManagementService: No managed key found for purpose '${purpose}'. ` +
          "Did you call initialize()?",
      );
    }
    if (managed.status === "destroyed") {
      throw new Error(`Managed key for purpose '${purpose}' has been destroyed`);
    }
    return managed;
  }

  /**
   * Re-encrypt all data for a given purpose after key rotation.
   * Purpose-specific re-encryption strategies are implemented here.
   */
  private async reEncryptPurposeData(
    purpose: ManagedKeyPurpose,
    previousManaged: ManagedKey,
  ): Promise<number> {
    switch (purpose) {
      case "pii":
        return this.reEncryptPiiFields();
      case "webhook-secrets":
        return this.reEncryptWebhookSecrets(previousManaged);
      case "oauth-tokens":
        return this.reEncryptOAuthTokens(previousManaged);
      default:
        // For other purposes, re-encryption is application-specific
        logger.info(
          { purpose },
          "No automatic re-encryption implemented for this purpose; manual re-encryption required",
        );
        return 0;
    }
  }

  /**
   * Re-encrypt PII fields by refreshing the EncryptionUtil cache.
   * The keyRotation.job's existing rotateUserPII logic will pick up the new key.
   */
  private async reEncryptPiiFields(): Promise<number> {
    // Refresh EncryptionUtil's cached keyset so it picks up the new key version
    EncryptionUtil.clearCache();
    this.wireEncryptionUtil();

    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM users
          WHERE phone_number_encrypted IS NOT NULL
             OR date_of_birth_encrypted IS NOT NULL
             OR government_id_number_encrypted IS NOT NULL
             OR bank_account_details_encrypted IS NOT NULL`,
      );
      logger.info(
        { affectedRows: rows[0].count },
        "PII re-encryption scheduled (run keyRotation.job to complete)",
      );
      return 0; // Actual re-encryption is done by keyRotation.job
    } catch {
      return 0;
    }
  }

  private async reEncryptWebhookSecrets(previousManaged: ManagedKey): Promise<number> {
    logger.info(
      { previousVersion: previousManaged.version },
      "Webhook secret re-encryption queued (run keyRotation.job to complete)",
    );
    return 0;
  }

  private async reEncryptOAuthTokens(previousManaged: ManagedKey): Promise<number> {
    logger.info(
      { previousVersion: previousManaged.version },
      "OAuth token re-encryption queued (run keyRotation.job to complete)",
    );
    return 0;
  }

  private async persistManagedKey(managed: ManagedKey): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO hsm_managed_keys
           (purpose, hsm_key_id, version, status, created_at, expires_at,
            previous_hsm_key_id, previous_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (purpose) DO UPDATE
           SET hsm_key_id = EXCLUDED.hsm_key_id,
               version = EXCLUDED.version,
               status = EXCLUDED.status,
               created_at = EXCLUDED.created_at,
               expires_at = EXCLUDED.expires_at,
               previous_hsm_key_id = EXCLUDED.previous_hsm_key_id,
               previous_version = EXCLUDED.previous_version`,
        [
          managed.purpose,
          managed.hsmKeyId,
          managed.version,
          managed.status,
          managed.createdAt,
          managed.expiresAt,
          managed.previousHsmKeyId ?? null,
          managed.previousVersion ?? null,
        ],
      );
    } catch {
      logger.debug(
        { purpose: managed.purpose },
        "hsm_managed_keys table not ready; skipping persist",
      );
    }
  }

  private async loadManagedKey(purpose: ManagedKeyPurpose): Promise<ManagedKey | null> {
    try {
      const { rows } = await pool.query<{
        purpose: ManagedKeyPurpose;
        hsm_key_id: string;
        version: string;
        status: ManagedKey["status"];
        created_at: Date;
        expires_at: Date;
        previous_hsm_key_id: string | null;
        previous_version: string | null;
      }>(
        `SELECT purpose, hsm_key_id, version, status, created_at, expires_at,
                previous_hsm_key_id, previous_version
           FROM hsm_managed_keys
          WHERE purpose = $1
            AND status != 'destroyed'
          LIMIT 1`,
        [purpose],
      );

      if (rows.length === 0) return null;
      const row = rows[0];

      return {
        purpose: row.purpose,
        hsmKeyId: row.hsm_key_id,
        version: row.version,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        previousHsmKeyId: row.previous_hsm_key_id ?? undefined,
        previousVersion: row.previous_version ?? undefined,
      };
    } catch {
      return null;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const keyManagementService = new KeyManagementService(hsmService);
export default keyManagementService;
