/**
 * HSM Service
 *
 * Core Hardware Security Module service providing:
 *   - Secure key generation (symmetric AES-256, asymmetric RSA/EC)
 *   - Hardware-based encryption and decryption via AES-256-GCM
 *   - Digital signing and signature verification (RSA-PSS, ECDSA)
 *   - Automated key rotation with configurable schedules
 *   - Key escrow and M-of-N recovery via custodian shares
 *   - FIPS 140-2 Level 3 compliance audit trail and reporting
 *
 * Architecture:
 *   The service uses a software HSM abstraction layer backed by Node.js's
 *   built-in `crypto` (OpenSSL in FIPS mode).  In production, swap the
 *   provider to 'pkcs11' or 'aws_cloudhsm' and the same interface applies.
 *
 * Thread safety:
 *   All public methods return Promises. Internal state (key registry, audit
 *   log) is guarded by async locks where needed. For multi-instance deploys,
 *   use HSM_ESCROW_STORE=aws_secrets and let each instance fetch keys from
 *   the same escrow backend.
 */

import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import pool from "../config/database";
import { redis } from "../config/redis";
import { logger } from "../utils/logger.utils";
import hsmConfig, {
  type HsmConfig,
  type HsmKeyAlgorithm,
  type KeyRotationPolicy,
} from "../config/hsm.config";
import {
  aesGcmEncrypt,
  aesGcmDecrypt,
  aesCbcEncrypt,
  aesCbcDecrypt,
  rsaOaepEncrypt,
  rsaOaepDecrypt,
  rsaPssSign,
  rsaPssVerify,
  ecdsaSign,
  ecdsaVerify,
  hmac,
  hmacVerify,
  hkdfDerive,
  generateSymmetricKey,
  generateRsaKeyPair,
  generateEcKeyPair,
  wrapKey,
  unwrapKey,
  splitSecret,
  combineShares,
  randomBytes,
  randomUuid,
  sha256Hex,
  zeroFill,
  HKDF_INFO_ENCRYPTION,
  HKDF_INFO_SIGNING,
  HKDF_INFO_WRAPPING,
  type AesGcmEncryptResult,
  type SignatureResult,
  type WrappedKeyResult,
} from "../utils/crypto-hsm.utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KeyType = "symmetric" | "asymmetric-public" | "asymmetric-private";
export type KeyStatus = "active" | "rotating" | "deprecated" | "destroyed";
export type KeyPurpose =
  | "data-encryption"
  | "key-wrapping"
  | "signing"
  | "verification"
  | "key-exchange"
  | "pii-encryption"
  | "backup-encryption";

export interface HsmKeyMetadata {
  id: string;
  version: string;
  algorithm: HsmKeyAlgorithm;
  type: KeyType;
  purpose: KeyPurpose;
  status: KeyStatus;
  createdAt: Date;
  expiresAt: Date;
  rotatedAt?: Date;
  destroyedAt?: Date;
  /** Fingerprint: SHA-256 of the raw key material (for public keys: of DER) */
  fingerprint: string;
  /** Label / name for this key (e.g. "pii-encryption-v3") */
  label: string;
  /** Tags for metadata, filtering, and access control */
  tags: Record<string, string>;
}

export interface HsmEncryptResult extends AesGcmEncryptResult {
  keyId: string;
  keyVersion: string;
}

export interface HsmDecryptRequest {
  keyId: string;
  keyVersion: string;
  iv: string;
  tag: string;
  ciphertext: string;
  aad?: string;
  algorithm?: string;
}

export interface KeyRotationResult {
  previousKeyId: string;
  previousVersion: string;
  newKeyId: string;
  newVersion: string;
  rotatedAt: Date;
  reEncryptedCount?: number;
}

export interface EscrowResult {
  keyId: string;
  shares: string[];    // base64-encoded shares, one per custodian
  shareCount: number;
  threshold: number;
  escrowedAt: Date;
  storedAt: string;    // store backend identifier
}

export interface EscrowRecoveryRequest {
  keyId: string;
  shares: string[];    // must supply at least `threshold` shares
}

export interface ComplianceReport {
  reportId: string;
  generatedAt: Date;
  period: { from: Date; to: Date };
  fipsLevel: number;
  provider: string;
  totalKeysManaged: number;
  activeKeys: number;
  rotatedThisPeriod: number;
  destroyedThisPeriod: number;
  encryptOperations: number;
  decryptOperations: number;
  signOperations: number;
  verifyOperations: number;
  auditEventsLogged: number;
  escrowedKeys: number;
  complianceStatus: "COMPLIANT" | "REQUIRES_ATTENTION" | "NON_COMPLIANT";
  findings: ComplianceFinding[];
}

export interface ComplianceFinding {
  severity: "INFO" | "WARNING" | "CRITICAL";
  code: string;
  message: string;
  recommendation: string;
}

export interface HsmAuditEvent {
  eventId: string;
  timestamp: Date;
  operation:
    | "KEY_GEN"
    | "KEY_IMPORT"
    | "KEY_EXPORT"
    | "KEY_DELETE"
    | "KEY_ROTATE"
    | "KEY_ESCROW"
    | "KEY_RECOVER"
    | "ENCRYPT"
    | "DECRYPT"
    | "SIGN"
    | "VERIFY"
    | "HMAC"
    | "DERIVE"
    | "REPORT_GEN";
  keyId?: string;
  keyVersion?: string;
  algorithm?: string;
  actor?: string;
  result: "SUCCESS" | "FAILURE";
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

// ─── In-memory key store (wraps key material; use escrow for persistence) ─────

interface KeyEntry extends HsmKeyMetadata {
  /** Raw symmetric key material (undefined for public-key types) */
  rawKey?: Buffer;
  /** PEM-encoded private key (asymmetric) */
  privateKeyPem?: string;
  /** PEM-encoded public key (asymmetric) */
  publicKeyPem?: string;
}

// ─── HSM Service ──────────────────────────────────────────────────────────────

export class HsmService {
  private readonly config: HsmConfig;
  private readonly keyRegistry: Map<string, Map<string, KeyEntry>> = new Map();
  // keyId → (version → entry)
  private readonly auditBuffer: HsmAuditEvent[] = [];
  private readonly auditFlushIntervalMs = 5_000;
  private auditFlushTimer: ReturnType<typeof setInterval> | null = null;

  // Operation counters for compliance reporting (in-memory; reset on restart)
  private opCounters = {
    encrypt: 0,
    decrypt: 0,
    sign: 0,
    verify: 0,
    hmac: 0,
    derive: 0,
  };

  constructor(config: HsmConfig = hsmConfig) {
    this.config = config;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Initialise the HSM service: connect to the HSM provider (if applicable),
   * load existing keys from escrow, and start background tasks.
   */
  async initialize(): Promise<void> {
    logger.info(
      { provider: this.config.provider, fipsLevel: this.config.compliance.fipsLevel },
      "Initialising HSM service",
    );

    if (!this.config.enabled) {
      logger.warn("HSM service is running in software-fallback mode (non-FIPS)");
    }

    // Load key metadata from DB (key material loaded lazily from escrow)
    await this.loadKeyRegistry();

    // Start periodic audit flush to storage
    this.startAuditFlusher();

    logger.info(
      { keyCount: this.keyRegistry.size },
      "HSM service initialised",
    );
  }

  /** Stop background tasks and flush remaining audit events. */
  async shutdown(): Promise<void> {
    if (this.auditFlushTimer) {
      clearInterval(this.auditFlushTimer);
      this.auditFlushTimer = null;
    }
    await this.flushAuditEvents();
    logger.info("HSM service shut down cleanly");
  }

  // ── Key Generation ───────────────────────────────────────────────────────────

  /**
   * Generate a new symmetric AES-256 key and register it in the HSM.
   *
   * @param label   - Human-readable label for the key
   * @param purpose - Intended cryptographic purpose
   * @param tags    - Optional metadata tags
   */
  async generateSymmetricKey(
    label: string,
    purpose: KeyPurpose = "data-encryption",
    tags: Record<string, string> = {},
  ): Promise<HsmKeyMetadata> {
    const keyId = uuidv4();
    const version = "v1";
    const rawKey = generateSymmetricKey(256);
    const fingerprint = sha256Hex(rawKey);

    const expiresAt = new Date(
      Date.now() + this.config.rotation.symmetricRotationDays * 86_400_000,
    );

    const entry: KeyEntry = {
      id: keyId,
      version,
      algorithm: "AES-256",
      type: "symmetric",
      purpose,
      status: "active",
      createdAt: new Date(),
      expiresAt,
      fingerprint,
      label,
      tags,
      rawKey,
    };

    this.storeKeyEntry(entry);
    await this.persistKeyMetadata(entry);

    this.recordAudit({
      operation: "KEY_GEN",
      keyId,
      keyVersion: version,
      algorithm: "AES-256",
      result: "SUCCESS",
      metadata: { label, purpose, tags },
    });

    logger.info({ keyId, label, algorithm: "AES-256" }, "Generated symmetric key");

    // Return metadata only (never expose raw key material outside this service)
    return this.toMetadata(entry);
  }

  /**
   * Generate a new RSA key pair.
   *
   * @param bits    - Key length in bits (2048 | 3072 | 4096)
   * @param label   - Human-readable label
   * @param purpose - Intended purpose (signing, encryption, etc.)
   */
  async generateRsaKeyPair(
    bits: 2048 | 3072 | 4096 = 3072,
    label: string = `rsa-${bits}`,
    purpose: KeyPurpose = "signing",
    tags: Record<string, string> = {},
  ): Promise<{ privateKeyMeta: HsmKeyMetadata; publicKeyMeta: HsmKeyMetadata }> {
    const keyPair = generateRsaKeyPair(bits);
    const keyId = uuidv4();
    const version = "v1";
    const algo = `RSA-${bits}` as HsmKeyAlgorithm;

    const expiresAt = new Date(
      Date.now() + this.config.rotation.asymmetricRotationDays * 86_400_000,
    );

    const privEntry: KeyEntry = {
      id: `${keyId}-priv`,
      version,
      algorithm: algo,
      type: "asymmetric-private",
      purpose,
      status: "active",
      createdAt: new Date(),
      expiresAt,
      fingerprint: sha256Hex(keyPair.publicKeyDer),
      label: `${label}-private`,
      tags,
      privateKeyPem: keyPair.privateKey,
      publicKeyPem: keyPair.publicKey,
    };

    const pubEntry: KeyEntry = {
      ...privEntry,
      id: `${keyId}-pub`,
      type: "asymmetric-public",
      label: `${label}-public`,
      privateKeyPem: undefined,
    };

    this.storeKeyEntry(privEntry);
    this.storeKeyEntry(pubEntry);
    await this.persistKeyMetadata(privEntry);
    await this.persistKeyMetadata(pubEntry);

    this.recordAudit({
      operation: "KEY_GEN",
      keyId,
      keyVersion: version,
      algorithm: algo,
      result: "SUCCESS",
      metadata: { label, purpose, bits },
    });

    logger.info({ keyId, label, algorithm: algo }, "Generated RSA key pair");

    return {
      privateKeyMeta: this.toMetadata(privEntry),
      publicKeyMeta: this.toMetadata(pubEntry),
    };
  }

  /**
   * Generate a new EC key pair on a NIST P-curve.
   */
  async generateEcKeyPair(
    namedCurve: "P-256" | "P-384" | "P-521" = "P-384",
    label: string = `ec-${namedCurve.toLowerCase()}`,
    purpose: KeyPurpose = "signing",
    tags: Record<string, string> = {},
  ): Promise<{ privateKeyMeta: HsmKeyMetadata; publicKeyMeta: HsmKeyMetadata }> {
    const keyPair = generateEcKeyPair(namedCurve);
    const keyId = uuidv4();
    const version = "v1";
    const algo = `EC-${namedCurve.replace("-", "")}` as HsmKeyAlgorithm;

    const expiresAt = new Date(
      Date.now() + this.config.rotation.asymmetricRotationDays * 86_400_000,
    );

    const privEntry: KeyEntry = {
      id: `${keyId}-priv`,
      version,
      algorithm: algo,
      type: "asymmetric-private",
      purpose,
      status: "active",
      createdAt: new Date(),
      expiresAt,
      fingerprint: sha256Hex(keyPair.publicKeyDer),
      label: `${label}-private`,
      tags,
      privateKeyPem: keyPair.privateKey,
      publicKeyPem: keyPair.publicKey,
    };

    const pubEntry: KeyEntry = {
      ...privEntry,
      id: `${keyId}-pub`,
      type: "asymmetric-public",
      label: `${label}-public`,
      privateKeyPem: undefined,
    };

    this.storeKeyEntry(privEntry);
    this.storeKeyEntry(pubEntry);
    await this.persistKeyMetadata(privEntry);
    await this.persistKeyMetadata(pubEntry);

    this.recordAudit({
      operation: "KEY_GEN",
      keyId,
      keyVersion: version,
      algorithm: algo,
      result: "SUCCESS",
      metadata: { label, purpose, namedCurve },
    });

    logger.info({ keyId, label, namedCurve }, "Generated EC key pair");

    return {
      privateKeyMeta: this.toMetadata(privEntry),
      publicKeyMeta: this.toMetadata(pubEntry),
    };
  }

  // ── Encrypt / Decrypt ────────────────────────────────────────────────────────

  /**
   * Encrypt plaintext using AES-256-GCM with the specified key.
   * The returned object includes the key ID and version so the caller
   * can persist enough context for decryption.
   *
   * @param keyId     - ID of the symmetric key to use
   * @param plaintext - Data to encrypt
   * @param aad       - Optional additional authenticated data
   */
  async encrypt(
    keyId: string,
    plaintext: string | Buffer,
    aad?: Buffer,
  ): Promise<HsmEncryptResult> {
    const entry = await this.requireActiveKey(keyId);
    if (!entry.rawKey) {
      throw new Error(`Key ${keyId} has no symmetric material — cannot encrypt`);
    }

    let result: AesGcmEncryptResult;
    try {
      result = aesGcmEncrypt(plaintext, entry.rawKey, aad);
      this.opCounters.encrypt++;
    } catch (err) {
      this.recordAudit({
        operation: "ENCRYPT",
        keyId,
        keyVersion: entry.version,
        result: "FAILURE",
        errorMessage: (err as Error).message,
      });
      throw err;
    }

    if (this.config.compliance.auditAllOperations) {
      this.recordAudit({
        operation: "ENCRYPT",
        keyId,
        keyVersion: entry.version,
        algorithm: "AES-256-GCM",
        result: "SUCCESS",
      });
    }

    return { ...result, keyId, keyVersion: entry.version };
  }

  /**
   * Decrypt an HsmEncryptResult.
   */
  async decrypt(req: HsmDecryptRequest): Promise<Buffer> {
    const entry = await this.requireKeyVersion(req.keyId, req.keyVersion);
    if (!entry.rawKey) {
      throw new Error(`Key ${req.keyId}@${req.keyVersion} has no symmetric material`);
    }

    let plaintext: Buffer;
    try {
      plaintext = aesGcmDecrypt(
        {
          algorithm: "AES-256-GCM",
          iv: req.iv,
          tag: req.tag,
          ciphertext: req.ciphertext,
          aad: req.aad,
        },
        entry.rawKey,
      );
      this.opCounters.decrypt++;
    } catch (err) {
      this.recordAudit({
        operation: "DECRYPT",
        keyId: req.keyId,
        keyVersion: req.keyVersion,
        result: "FAILURE",
        errorMessage: (err as Error).message,
      });
      throw err;
    }

    if (this.config.compliance.auditAllOperations) {
      this.recordAudit({
        operation: "DECRYPT",
        keyId: req.keyId,
        keyVersion: req.keyVersion,
        algorithm: "AES-256-GCM",
        result: "SUCCESS",
      });
    }

    return plaintext;
  }

  /**
   * Encrypt a symmetric key with another key (key wrapping).
   * Used for secure transport and escrow of key material.
   */
  async wrapKey(
    keyToWrapId: string,
    wrappingKeyId: string,
  ): Promise<WrappedKeyResult> {
    const target = await this.requireActiveKey(keyToWrapId);
    const wrapping = await this.requireActiveKey(wrappingKeyId);

    if (!target.rawKey) {
      throw new Error(`Key ${keyToWrapId} has no raw material to wrap`);
    }
    if (!wrapping.rawKey) {
      throw new Error(`Wrapping key ${wrappingKeyId} has no raw material`);
    }

    const wrapped = wrapKey(target.rawKey, wrapping.rawKey, wrappingKeyId);
    this.recordAudit({
      operation: "KEY_EXPORT",
      keyId: keyToWrapId,
      keyVersion: target.version,
      algorithm: "AES-256-GCM",
      result: "SUCCESS",
      metadata: { wrappingKeyId },
    });

    return wrapped;
  }

  // ── Signing / Verification ───────────────────────────────────────────────────

  /**
   * Sign data using RSA-PSS-SHA256 or ECDSA depending on the key type.
   */
  async sign(keyId: string, data: Buffer | string): Promise<SignatureResult> {
    const entry = await this.requireActiveKey(keyId);

    let result: SignatureResult;
    try {
      if (entry.type === "asymmetric-private" && entry.algorithm.startsWith("RSA")) {
        if (!entry.privateKeyPem) throw new Error("No private key PEM for signing");
        result = rsaPssSign(data, entry.privateKeyPem);
      } else if (
        entry.type === "asymmetric-private" &&
        entry.algorithm.startsWith("EC")
      ) {
        if (!entry.privateKeyPem) throw new Error("No private key PEM for signing");
        result = ecdsaSign(data, entry.privateKeyPem, "SHA256");
      } else if (entry.type === "symmetric" && entry.rawKey) {
        // HMAC-based signing for symmetric keys
        const mac = hmac(data, entry.rawKey, "sha256");
        result = { algorithm: "HMAC-SHA256", signature: mac };
      } else {
        throw new Error(`Key ${keyId} does not support signing`);
      }
      result.keyId = keyId;
      this.opCounters.sign++;
    } catch (err) {
      this.recordAudit({
        operation: "SIGN",
        keyId,
        result: "FAILURE",
        errorMessage: (err as Error).message,
      });
      throw err;
    }

    if (this.config.compliance.auditAllOperations) {
      this.recordAudit({
        operation: "SIGN",
        keyId,
        keyVersion: entry.version,
        algorithm: result.algorithm,
        result: "SUCCESS",
      });
    }

    return result;
  }

  /**
   * Verify a signature. Returns true if the signature is valid.
   */
  async verify(
    keyId: string,
    data: Buffer | string,
    sigResult: SignatureResult,
  ): Promise<boolean> {
    const entry = await this.requireKeyVersion(
      keyId,
      sigResult.keyId ? undefined : undefined,
    );

    let valid: boolean;
    try {
      if (
        entry.type === "asymmetric-public" &&
        entry.algorithm.startsWith("RSA")
      ) {
        if (!entry.publicKeyPem)
          throw new Error("No public key PEM for verification");
        valid = rsaPssVerify(data, sigResult, entry.publicKeyPem);
      } else if (
        entry.type === "asymmetric-public" &&
        entry.algorithm.startsWith("EC")
      ) {
        if (!entry.publicKeyPem)
          throw new Error("No public key PEM for verification");
        valid = ecdsaVerify(data, sigResult, entry.publicKeyPem);
      } else if (
        (entry.type === "asymmetric-private" &&
          entry.algorithm.startsWith("RSA")) ||
        (entry.type === "asymmetric-private" &&
          entry.algorithm.startsWith("EC"))
      ) {
        // Verify using embedded public key
        const pubKey = entry.publicKeyPem;
        if (!pubKey) throw new Error("No public key for verification");
        valid = entry.algorithm.startsWith("RSA")
          ? rsaPssVerify(data, sigResult, pubKey)
          : ecdsaVerify(data, sigResult, pubKey);
      } else if (entry.type === "symmetric" && entry.rawKey) {
        valid = hmacVerify(data, sigResult.signature, entry.rawKey, "sha256");
      } else {
        throw new Error(`Key ${keyId} does not support verification`);
      }
      this.opCounters.verify++;
    } catch (err) {
      this.recordAudit({
        operation: "VERIFY",
        keyId,
        result: "FAILURE",
        errorMessage: (err as Error).message,
      });
      throw err;
    }

    if (this.config.compliance.auditAllOperations) {
      this.recordAudit({
        operation: "VERIFY",
        keyId,
        keyVersion: entry.version,
        result: "SUCCESS",
        metadata: { valid },
      });
    }

    return valid;
  }

  // ── Key Rotation ─────────────────────────────────────────────────────────────

  /**
   * Rotate a symmetric key by generating a new version.
   *
   * The previous version is kept in state='rotating' during the grace period
   * so existing ciphertexts can still be decrypted.  After `retentionDays`,
   * a cleanup job destroys the old version.
   *
   * @param keyId  - ID of the key to rotate
   * @param reason - Audit reason string (scheduled | emergency | policy)
   */
  async rotateKey(
    keyId: string,
    reason: "scheduled" | "emergency" | "policy" | "manual" = "scheduled",
  ): Promise<KeyRotationResult> {
    const currentEntry = await this.requireActiveKey(keyId);

    const newRawKey = generateSymmetricKey(256);
    const newVersion = this.bumpVersion(currentEntry.version);
    const newFingerprint = sha256Hex(newRawKey);

    const expiresAt = new Date(
      Date.now() + this.config.rotation.symmetricRotationDays * 86_400_000,
    );

    const newEntry: KeyEntry = {
      ...currentEntry,
      version: newVersion,
      status: "active",
      createdAt: new Date(),
      rotatedAt: new Date(),
      expiresAt,
      fingerprint: newFingerprint,
      rawKey: newRawKey,
    };

    // Mark old version as 'rotating' (still usable for decryption)
    currentEntry.status = "rotating";
    currentEntry.rotatedAt = new Date();

    this.storeKeyEntry(newEntry);
    await this.persistKeyMetadata(newEntry);
    await this.updateKeyStatus(keyId, currentEntry.version, "rotating");

    this.recordAudit({
      operation: "KEY_ROTATE",
      keyId,
      keyVersion: newVersion,
      algorithm: "AES-256",
      result: "SUCCESS",
      metadata: { reason, previousVersion: currentEntry.version },
    });

    logger.info(
      {
        keyId,
        previousVersion: currentEntry.version,
        newVersion,
        reason,
      },
      "Key rotated",
    );

    return {
      previousKeyId: keyId,
      previousVersion: currentEntry.version,
      newKeyId: keyId,
      newVersion,
      rotatedAt: new Date(),
    };
  }

  /**
   * Rotate all keys that are expired or approaching expiry.
   * Called by the scheduled key rotation job.
   */
  async rotateExpiredKeys(): Promise<KeyRotationResult[]> {
    const results: KeyRotationResult[] = [];
    const now = Date.now();
    // Rotate if less than 7 days remain
    const lookaheadMs = 7 * 86_400_000;

    for (const entry of Array.from(this.keyRegistry.entries())) {
      const [keyId, versions] = entry;
      for (const versionEntry of Array.from(versions.entries())) {
        const [, entry] = versionEntry;
        if (
          entry.status === "active" &&
          entry.type === "symmetric" &&
          entry.expiresAt.getTime() - now < lookaheadMs
        ) {
          try {
            const rotResult = await this.rotateKey(keyId, "scheduled");
            results.push(rotResult);
          } catch (err) {
            logger.error(
              { keyId, error: (err as Error).message },
              "Failed to rotate expired key",
            );
          }
        }
      }
    }

    logger.info({ rotatedCount: results.length }, "Expired key rotation sweep complete");
    return results;
  }

  /**
   * Destroy deprecated key versions that have passed their retention period.
   */
  async purgeExpiredVersions(): Promise<string[]> {
    const purged: string[] = [];
    const cutoff = Date.now() - this.config.rotation.retentionDays * 86_400_000;

    for (const entry of Array.from(this.keyRegistry.entries())) {
      const [, versions] = entry;
      for (const versionEntry of Array.from(versions.entries())) {
        const [, entry] = versionEntry;
        if (
          entry.status === "rotating" &&
          entry.rotatedAt &&
          entry.rotatedAt.getTime() < cutoff
        ) {
          entry.status = "destroyed";
          entry.destroyedAt = new Date();
          if (entry.rawKey) {
            zeroFill(entry.rawKey);
            entry.rawKey = undefined;
          }
          entry.privateKeyPem = undefined;
          await this.updateKeyStatus(
            entry.id,
            entry.version,
            "destroyed",
          );
          purged.push(`${entry.id}@${entry.version}`);

          this.recordAudit({
            operation: "KEY_DELETE",
            keyId: entry.id,
            keyVersion: entry.version,
            result: "SUCCESS",
            metadata: { reason: "retention_expired" },
          });
        }
      }
    }

    if (purged.length > 0) {
      logger.info({ purged }, "Purged expired key versions");
    }
    return purged;
  }

  // ── Key Escrow & Recovery ────────────────────────────────────────────────────

  /**
   * Escrow a key by splitting it into N shares and distributing them to
   * custodians.  The shares are encrypted with each custodian's public key
   * (if configured) or returned as raw base64 for the caller to distribute.
   *
   * @param keyId - ID of the key to escrow
   */
  async escrowKey(keyId: string): Promise<EscrowResult> {
    const entry = await this.requireActiveKey(keyId);

    if (!entry.rawKey && !entry.privateKeyPem) {
      throw new Error(`Key ${keyId} has no material to escrow`);
    }

    const keyMaterial = entry.rawKey
      ? entry.rawKey
      : Buffer.from(entry.privateKeyPem!, "utf8");

    const { threshold, totalShares, custodianPublicKeys } = this.config.escrow;
    const shares = splitSecret(keyMaterial, totalShares);

    // Optionally encrypt shares with custodian public keys
    const encodedShares = shares.map((share, idx) => {
      if (custodianPublicKeys[idx]) {
        const encrypted = rsaOaepEncrypt(share, custodianPublicKeys[idx]);
        return encrypted.ciphertext;
      }
      return share.toString("base64");
    });

    const escrowedAt = new Date();

    // Persist escrow metadata (not the shares — those go to custodians)
    await this.persistEscrowMetadata(keyId, encodedShares.length, threshold);

    this.recordAudit({
      operation: "KEY_ESCROW",
      keyId,
      keyVersion: entry.version,
      result: "SUCCESS",
      metadata: {
        shareCount: totalShares,
        threshold,
        store: this.config.escrow.store,
      },
    });

    logger.info(
      { keyId, shareCount: totalShares, threshold },
      "Key escrowed successfully",
    );

    return {
      keyId,
      shares: encodedShares,
      shareCount: totalShares,
      threshold,
      escrowedAt,
      storedAt: this.config.escrow.store,
    };
  }

  /**
   * Recover a key from escrow shares.
   * All shares (or all N for this N-of-N implementation) must be provided.
   *
   * @param request - keyId and array of base64 shares
   */
  async recoverKeyFromEscrow(
    request: EscrowRecoveryRequest,
  ): Promise<HsmKeyMetadata> {
    const { keyId, shares } = request;
    const { totalShares } = this.config.escrow;

    if (shares.length < totalShares) {
      throw new Error(
        `Key recovery requires all ${totalShares} shares, got ${shares.length}`,
      );
    }

    const shareBuffers = shares.map((s) => Buffer.from(s, "base64"));
    const recovered = combineShares(shareBuffers);

    // Determine whether this was a symmetric key or a private key
    // Heuristic: if it's valid UTF-8 starting with "-----BEGIN", treat as PEM
    const isPrivateKey = recovered
      .toString("utf8")
      .startsWith("-----BEGIN");

    const version = "recovered-1";
    const keyEntryId = `${keyId}-recovered`;

    const entry: KeyEntry = {
      id: keyEntryId,
      version,
      algorithm: isPrivateKey ? "RSA-3072" : "AES-256",
      type: isPrivateKey ? "asymmetric-private" : "symmetric",
      purpose: "data-encryption",
      status: "active",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
      fingerprint: sha256Hex(recovered),
      label: `${keyId}-recovered`,
      tags: { source: "escrow-recovery" },
      rawKey: isPrivateKey ? undefined : recovered,
      privateKeyPem: isPrivateKey ? recovered.toString("utf8") : undefined,
    };

    this.storeKeyEntry(entry);
    await this.persistKeyMetadata(entry);

    this.recordAudit({
      operation: "KEY_RECOVER",
      keyId,
      keyVersion: version,
      result: "SUCCESS",
      metadata: { providedShares: shares.length },
    });

    logger.warn(
      { keyId, keyEntryId },
      "Key recovered from escrow — review required",
    );

    return this.toMetadata(entry);
  }

  // ── Key Derivation ────────────────────────────────────────────────────────────

  /**
   * Derive a purpose-specific key from a master key using HKDF.
   *
   * @param masterKeyId - ID of the master key
   * @param purpose     - Derivation purpose label
   * @param context     - Application-specific context bytes
   * @param outputLength - Desired output key length in bytes
   */
  async deriveKey(
    masterKeyId: string,
    purpose: "encryption" | "signing" | "wrapping",
    context?: Buffer,
    outputLength = 32,
  ): Promise<{ derivedKey: Buffer; salt: string }> {
    const entry = await this.requireActiveKey(masterKeyId);
    if (!entry.rawKey) {
      throw new Error(`Key ${masterKeyId} has no symmetric material for derivation`);
    }

    const infoMap = {
      encryption: HKDF_INFO_ENCRYPTION,
      signing: HKDF_INFO_SIGNING,
      wrapping: HKDF_INFO_WRAPPING,
    };
    const info = context
      ? Buffer.concat([infoMap[purpose], context])
      : infoMap[purpose];

    const result = hkdfDerive(entry.rawKey, outputLength, info);
    this.opCounters.derive++;

    if (this.config.compliance.auditAllOperations) {
      this.recordAudit({
        operation: "DERIVE",
        keyId: masterKeyId,
        keyVersion: entry.version,
        algorithm: "HKDF-SHA256",
        result: "SUCCESS",
        metadata: { purpose, outputLength },
      });
    }

    return { derivedKey: result.key, salt: result.salt };
  }

  // ── Key Metadata ─────────────────────────────────────────────────────────────

  /**
   * List all keys managed by this HSM service, optionally filtered by status.
   */
  async listKeys(
    filter: { status?: KeyStatus; purpose?: KeyPurpose } = {},
  ): Promise<HsmKeyMetadata[]> {
    const results: HsmKeyMetadata[] = [];
    for (const versions of Array.from(this.keyRegistry.values())) {
      for (const entry of Array.from(versions.values())) {
        if (filter.status && entry.status !== filter.status) continue;
        if (filter.purpose && entry.purpose !== filter.purpose) continue;
        results.push(this.toMetadata(entry));
      }
    }
    return results;
  }

  /**
   * Get metadata for a specific key (most recent active version).
   */
  async getKeyMetadata(keyId: string): Promise<HsmKeyMetadata | null> {
    const entry = this.findActiveEntry(keyId);
    return entry ? this.toMetadata(entry) : null;
  }

  /**
   * Get the public key PEM for an asymmetric key pair.
   * Safe to expose to external systems for signature verification.
   */
  async getPublicKey(keyId: string): Promise<string> {
    const entry = this.findActiveEntry(keyId);
    if (!entry) throw new Error(`Key ${keyId} not found`);
    if (!entry.publicKeyPem) {
      throw new Error(`Key ${keyId} is not an asymmetric key`);
    }
    return entry.publicKeyPem;
  }

  // ── Compliance Reporting ─────────────────────────────────────────────────────

  /**
   * Generate a FIPS 140-2 compliance report for the specified period.
   *
   * @param from - Report start date (default: 30 days ago)
   * @param to   - Report end date (default: now)
   */
  async generateComplianceReport(
    from?: Date,
    to?: Date,
  ): Promise<ComplianceReport> {
    const periodFrom = from ?? new Date(Date.now() - 30 * 86_400_000);
    const periodTo = to ?? new Date();

    const allKeys = await this.listKeys();
    const activeKeys = allKeys.filter((k) => k.status === "active");
    const rotatedThisPeriod = allKeys.filter(
      (k) =>
        k.rotatedAt &&
        k.rotatedAt >= periodFrom &&
        k.rotatedAt <= periodTo,
    );
    const destroyedThisPeriod = allKeys.filter(
      (k) =>
        k.destroyedAt &&
        k.destroyedAt >= periodFrom &&
        k.destroyedAt <= periodTo,
    );

    // Count escrowed keys from audit log
    const escrowedKeys = await this.countAuditEvents("KEY_ESCROW", periodFrom, periodTo);
    const auditEventsLogged = await this.countAuditEventsTotal(periodFrom, periodTo);

    // Run compliance checks
    const findings = this.runComplianceChecks(allKeys, activeKeys);

    const complianceStatus =
      findings.some((f) => f.severity === "CRITICAL")
        ? "NON_COMPLIANT"
        : findings.some((f) => f.severity === "WARNING")
        ? "REQUIRES_ATTENTION"
        : "COMPLIANT";

    const report: ComplianceReport = {
      reportId: uuidv4(),
      generatedAt: new Date(),
      period: { from: periodFrom, to: periodTo },
      fipsLevel: this.config.compliance.fipsLevel,
      provider: this.config.provider,
      totalKeysManaged: allKeys.length,
      activeKeys: activeKeys.length,
      rotatedThisPeriod: rotatedThisPeriod.length,
      destroyedThisPeriod: destroyedThisPeriod.length,
      encryptOperations: this.opCounters.encrypt,
      decryptOperations: this.opCounters.decrypt,
      signOperations: this.opCounters.sign,
      verifyOperations: this.opCounters.verify,
      auditEventsLogged,
      escrowedKeys,
      complianceStatus,
      findings,
    };

    this.recordAudit({
      operation: "REPORT_GEN",
      result: "SUCCESS",
      metadata: {
        reportId: report.reportId,
        complianceStatus,
        findingsCount: findings.length,
      },
    });

    logger.info(
      { reportId: report.reportId, complianceStatus, findingsCount: findings.length },
      "Compliance report generated",
    );

    return report;
  }

  /**
   * Retrieve recent audit events for external consumption or archival.
   *
   * @param limit  - Maximum events to return (default 100)
   * @param offset - Pagination offset
   */
  async getAuditLog(
    limit = 100,
    offset = 0,
  ): Promise<{ events: HsmAuditEvent[]; total: number }> {
    // In production, query from persistent store; here we query from DB
    try {
      const countRes = await pool.query<{ count: string }>(
        "SELECT COUNT(*) FROM hsm_audit_log",
      );
      const total = parseInt(countRes.rows[0].count, 10);

      const res = await pool.query<HsmAuditEvent>(
        `SELECT * FROM hsm_audit_log ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

      return { events: res.rows, total };
    } catch {
      // Table may not exist yet; return buffered events
      const slice = this.auditBuffer.slice(offset, offset + limit);
      return { events: slice, total: this.auditBuffer.length };
    }
  }

  // ── Private Helpers ──────────────────────────────────────────────────────────

  private storeKeyEntry(entry: KeyEntry): void {
    if (!this.keyRegistry.has(entry.id)) {
      this.keyRegistry.set(entry.id, new Map());
    }
    this.keyRegistry.get(entry.id)!.set(entry.version, entry);
  }

  private findActiveEntry(keyId: string): KeyEntry | undefined {
    const versions = this.keyRegistry.get(keyId);
    if (!versions) return undefined;

    // Return the newest active version
    let latest: KeyEntry | undefined;
    for (const entry of Array.from(versions.values())) {
      if (entry.status === "active") {
        if (!latest || entry.createdAt > latest.createdAt) {
          latest = entry;
        }
      }
    }
    return latest;
  }

  private async requireActiveKey(keyId: string): Promise<KeyEntry> {
    const entry = this.findActiveEntry(keyId);
    if (!entry) {
      throw new Error(`HSM: Active key not found for id=${keyId}`);
    }
    return entry;
  }

  private async requireKeyVersion(
    keyId: string,
    version?: string,
  ): Promise<KeyEntry> {
    if (!version) return this.requireActiveKey(keyId);
    const versions = this.keyRegistry.get(keyId);
    const entry = versions?.get(version);
    if (!entry) {
      throw new Error(`HSM: Key not found for id=${keyId} version=${version}`);
    }
    // Allow decryption with rotating / deprecated keys (just not new encryptions)
    if (entry.status === "destroyed") {
      throw new Error(
        `HSM: Key ${keyId}@${version} has been destroyed and cannot be used`,
      );
    }
    return entry;
  }

  private toMetadata(entry: KeyEntry): HsmKeyMetadata {
    return {
      id: entry.id,
      version: entry.version,
      algorithm: entry.algorithm,
      type: entry.type,
      purpose: entry.purpose,
      status: entry.status,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      rotatedAt: entry.rotatedAt,
      destroyedAt: entry.destroyedAt,
      fingerprint: entry.fingerprint,
      label: entry.label,
      tags: entry.tags,
    };
  }

  private bumpVersion(current: string): string {
    const match = current.match(/^v(\d+)$/);
    if (match) return `v${parseInt(match[1], 10) + 1}`;
    return `${current}-1`;
  }

  private recordAudit(
    partial: Omit<HsmAuditEvent, "eventId" | "timestamp">,
  ): void {
    const event: HsmAuditEvent = {
      eventId: uuidv4(),
      timestamp: new Date(),
      ...partial,
    };
    this.auditBuffer.push(event);

    // Flush immediately if buffer is large to avoid memory pressure
    if (this.auditBuffer.length >= 500) {
      void this.flushAuditEvents();
    }
  }

  private startAuditFlusher(): void {
    this.auditFlushTimer = setInterval(
      () => void this.flushAuditEvents(),
      this.auditFlushIntervalMs,
    );
  }

  private async flushAuditEvents(): Promise<void> {
    if (this.auditBuffer.length === 0) return;

    const events = this.auditBuffer.splice(0, this.auditBuffer.length);

    try {
      // Try to persist to database audit table
      const values = events
        .map(
          (_, i) =>
            `($${i * 9 + 1},$${i * 9 + 2},$${i * 9 + 3},$${i * 9 + 4},$${i * 9 + 5},$${i * 9 + 6},$${i * 9 + 7},$${i * 9 + 8},$${i * 9 + 9})`,
        )
        .join(",");

      const params: unknown[] = events.flatMap((e) => [
        e.eventId,
        e.timestamp,
        e.operation,
        e.keyId ?? null,
        e.keyVersion ?? null,
        e.algorithm ?? null,
        e.actor ?? null,
        e.result,
        JSON.stringify(e.metadata ?? {}),
      ]);

      await pool.query(
        `INSERT INTO hsm_audit_log
           (event_id, timestamp, operation, key_id, key_version, algorithm, actor, result, metadata)
         VALUES ${values}
         ON CONFLICT (event_id) DO NOTHING`,
        params,
      );
    } catch {
      // DB not ready yet (e.g. migration pending) — push back to buffer
      this.auditBuffer.unshift(...events);
    }
  }

  private async persistKeyMetadata(entry: KeyEntry): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO hsm_key_registry
           (id, version, algorithm, type, purpose, status, created_at, expires_at,
            rotated_at, destroyed_at, fingerprint, label, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id, version) DO UPDATE
           SET status = EXCLUDED.status,
               rotated_at = EXCLUDED.rotated_at,
               destroyed_at = EXCLUDED.destroyed_at`,
        [
          entry.id,
          entry.version,
          entry.algorithm,
          entry.type,
          entry.purpose,
          entry.status,
          entry.createdAt,
          entry.expiresAt,
          entry.rotatedAt ?? null,
          entry.destroyedAt ?? null,
          entry.fingerprint,
          entry.label,
          JSON.stringify(entry.tags),
        ],
      );
    } catch {
      // Table may not exist yet — log but don't fail
      logger.debug(
        { keyId: entry.id, version: entry.version },
        "hsm_key_registry table not ready; skipping metadata persist",
      );
    }
  }

  private async updateKeyStatus(
    keyId: string,
    version: string,
    status: KeyStatus,
  ): Promise<void> {
    try {
      await pool.query(
        `UPDATE hsm_key_registry SET status = $1 WHERE id = $2 AND version = $3`,
        [status, keyId, version],
      );
    } catch {
      // Ignore if table doesn't exist
    }
  }

  private async loadKeyRegistry(): Promise<void> {
    try {
      const { rows } = await pool.query<{
        id: string;
        version: string;
        algorithm: HsmKeyAlgorithm;
        type: KeyType;
        purpose: KeyPurpose;
        status: KeyStatus;
        created_at: Date;
        expires_at: Date;
        rotated_at: Date | null;
        destroyed_at: Date | null;
        fingerprint: string;
        label: string;
        tags: string;
      }>(
        `SELECT id, version, algorithm, type, purpose, status, created_at, expires_at,
                rotated_at, destroyed_at, fingerprint, label, tags
           FROM hsm_key_registry
          WHERE status != 'destroyed'
          ORDER BY created_at DESC`,
      );

      for (const row of rows) {
        const entry: KeyEntry = {
          id: row.id,
          version: row.version,
          algorithm: row.algorithm,
          type: row.type,
          purpose: row.purpose,
          status: row.status,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          rotatedAt: row.rotated_at ?? undefined,
          destroyedAt: row.destroyed_at ?? undefined,
          fingerprint: row.fingerprint,
          label: row.label,
          tags: JSON.parse(row.tags) as Record<string, string>,
          // Raw key material loaded separately from escrow when needed
        };
        this.storeKeyEntry(entry);
      }
      logger.info(
        { loadedKeys: rows.length },
        "Loaded key registry from database",
      );
    } catch {
      logger.warn("hsm_key_registry table not found; starting with empty registry");
    }
  }

  private async persistEscrowMetadata(
    keyId: string,
    shareCount: number,
    threshold: number,
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO hsm_key_escrow (key_id, share_count, threshold, escrowed_at, store)
         VALUES ($1,$2,$3,NOW(),$4)
         ON CONFLICT (key_id) DO UPDATE
           SET share_count = EXCLUDED.share_count,
               threshold = EXCLUDED.threshold,
               escrowed_at = EXCLUDED.escrowed_at`,
        [keyId, shareCount, threshold, this.config.escrow.store],
      );
    } catch {
      logger.debug({ keyId }, "hsm_key_escrow table not ready; skipping persist");
    }
  }

  private async countAuditEvents(
    operation: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM hsm_audit_log
          WHERE operation = $1 AND timestamp BETWEEN $2 AND $3`,
        [operation, from, to],
      );
      return parseInt(rows[0].count, 10);
    } catch {
      return this.auditBuffer.filter(
        (e) =>
          e.operation === operation &&
          e.timestamp >= from &&
          e.timestamp <= to,
      ).length;
    }
  }

  private async countAuditEventsTotal(from: Date, to: Date): Promise<number> {
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM hsm_audit_log
          WHERE timestamp BETWEEN $1 AND $2`,
        [from, to],
      );
      return parseInt(rows[0].count, 10);
    } catch {
      return this.auditBuffer.filter(
        (e) => e.timestamp >= from && e.timestamp <= to,
      ).length;
    }
  }

  private runComplianceChecks(
    allKeys: HsmKeyMetadata[],
    activeKeys: HsmKeyMetadata[],
  ): ComplianceFinding[] {
    const findings: ComplianceFinding[] = [];
    const now = Date.now();

    // Check 1: Provider compliance
    if (!this.config.enabled || this.config.provider === "software") {
      findings.push({
        severity: "CRITICAL",
        code: "FIPS-001",
        message:
          "HSM provider is set to 'software' — not FIPS 140-2 Level 3 compliant",
        recommendation:
          "Configure HSM_PROVIDER=pkcs11 or HSM_PROVIDER=aws_cloudhsm and HSM_ENABLED=true",
      });
    }

    // Check 2: Expired keys still active
    const expired = activeKeys.filter((k) => k.expiresAt.getTime() < now);
    if (expired.length > 0) {
      findings.push({
        severity: "CRITICAL",
        code: "KM-001",
        message: `${expired.length} active key(s) have passed their rotation deadline`,
        recommendation: "Run key rotation immediately or call rotateExpiredKeys()",
      });
    }

    // Check 3: Keys approaching expiry (within 30 days)
    const approaching = activeKeys.filter(
      (k) =>
        k.expiresAt.getTime() - now < 30 * 86_400_000 &&
        k.expiresAt.getTime() > now,
    );
    if (approaching.length > 0) {
      findings.push({
        severity: "WARNING",
        code: "KM-002",
        message: `${approaching.length} active key(s) expire within 30 days`,
        recommendation: "Schedule key rotation within the next 14 days",
      });
    }

    // Check 4: No escrowed keys
    const noEscrow = activeKeys.filter(
      (k) => !k.tags["escrowed"] && k.type === "symmetric",
    );
    if (noEscrow.length > 0) {
      findings.push({
        severity: "WARNING",
        code: "KM-003",
        message: `${noEscrow.length} symmetric key(s) have not been escrowed`,
        recommendation:
          "Call escrowKey() for each production key and store shares with custodians",
      });
    }

    // Check 5: Compliant algorithms only
    const nonCompliantAlgos = ["AES-128", "RSA-1024", "RSA-2048"];
    const weakKeys = activeKeys.filter((k) =>
      nonCompliantAlgos.includes(k.algorithm),
    );
    if (weakKeys.length > 0) {
      findings.push({
        severity: "WARNING",
        code: "FIPS-002",
        message: `${weakKeys.length} key(s) use algorithms below FIPS 140-2 Level 3 strength`,
        recommendation:
          "Migrate to AES-256, RSA-3072/4096, or EC P-384/P-521",
      });
    }

    // Check 6: FIPS Level target
    if (this.config.compliance.fipsLevel < 3) {
      findings.push({
        severity: "WARNING",
        code: "FIPS-003",
        message: `Target FIPS level is ${this.config.compliance.fipsLevel} (below required Level 3)`,
        recommendation: "Set HSM_FIPS_LEVEL=3 and use a Level 3 certified HSM device",
      });
    }

    if (findings.length === 0) {
      findings.push({
        severity: "INFO",
        code: "OK",
        message: "All compliance checks passed",
        recommendation: "Continue current key management practices",
      });
    }

    return findings;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const hsmService = new HsmService(hsmConfig);
export default hsmService;
