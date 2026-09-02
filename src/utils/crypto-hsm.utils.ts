/**
 * HSM Cryptographic Utilities
 *
 * Low-level, FIPS 140-2 Level 3 compliant cryptographic primitives built on
 * Node.js's built-in `crypto` module (which wraps OpenSSL in FIPS mode).
 *
 * These utilities are consumed by HsmService and must NOT be used directly
 * by application code — always go through HsmService for auditability.
 *
 * FIPS-approved algorithms used:
 *   - AES-256-GCM       (NIST SP 800-38D)
 *   - AES-256-CBC       (NIST SP 800-38A)
 *   - RSA-OAEP / PSS    (NIST SP 800-56B, PKCS#1 v2.2)
 *   - ECDSA / ECDH      (NIST SP 800-56A, curves P-256/P-384/P-521)
 *   - HKDF              (RFC 5869, NIST SP 800-56C)
 *   - HMAC-SHA-256/384/512 (FIPS 198-1)
 *   - PBKDF2            (NIST SP 800-132)
 *
 * NEVER use: MD5, SHA-1, DES, 3DES, RC4, ECB mode.
 */

import * as crypto from "crypto";
import {
  type CipherGCMTypes,
  type KeyObject,
  type webcrypto,
} from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

export const AES_GCM_IV_LENGTH = 12;   // 96-bit IV (NIST recommended for GCM)
export const AES_GCM_TAG_LENGTH = 16;  // 128-bit auth tag
export const AES_CBC_IV_LENGTH = 16;   // 128-bit IV

// HKDF info labels
export const HKDF_INFO_ENCRYPTION = Buffer.from("MentorMinds-Encryption-v1", "utf8");
export const HKDF_INFO_SIGNING = Buffer.from("MentorMinds-Signing-v1", "utf8");
export const HKDF_INFO_WRAPPING = Buffer.from("MentorMinds-Wrapping-v1", "utf8");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AesGcmEncryptResult {
  algorithm: "AES-256-GCM";
  iv: string;          // base64
  tag: string;         // base64
  ciphertext: string;  // base64
  aad?: string;        // base64 (optional Associated Authenticated Data)
}

export interface AesCbcEncryptResult {
  algorithm: "AES-256-CBC";
  iv: string;         // base64
  ciphertext: string; // base64
}

export interface RsaEncryptResult {
  algorithm: "RSA-OAEP-SHA256";
  ciphertext: string; // base64
}

export interface SignatureResult {
  algorithm: string;
  signature: string;  // base64
  keyId?: string;
}

export interface HkdfResult {
  key: Buffer;
  salt: string; // base64
  info: string; // base64
}

export interface KeyPairResult {
  algorithm: string;
  publicKey: string;  // PEM
  privateKey: string; // PEM
  publicKeyDer: string;  // base64 DER
}

export interface WrappedKeyResult {
  algorithm: "AES-256-GCM";
  wrappingKeyId: string;
  iv: string;       // base64
  tag: string;      // base64
  wrappedKey: string; // base64
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a 256-bit AES key from raw key material using SHA-256.
 * Used to normalise any raw secret into a fixed-length key buffer.
 */
export function deriveKeyBuffer(rawKey: Buffer | string): Buffer {
  const input = typeof rawKey === "string" ? Buffer.from(rawKey, "base64") : rawKey;
  return crypto.createHash("sha256").update(input).digest();
}

/**
 * Constant-time buffer comparison to prevent timing attacks.
 */
export function safeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Securely zero-fill a buffer to clear key material from memory.
 * Should be called on sensitive buffers before they go out of scope.
 */
export function zeroFill(buf: Buffer): void {
  buf.fill(0);
}

/**
 * Generate cryptographically secure random bytes using the OS CSPRNG.
 * Wraps crypto.randomBytes and asserts the length is positive.
 */
export function randomBytes(length: number): Buffer {
  if (length <= 0) throw new Error("randomBytes: length must be positive");
  return crypto.randomBytes(length);
}

/**
 * Generate a version-4 UUID using the OS CSPRNG.
 */
export function randomUuid(): string {
  return crypto.randomUUID();
}

// ─── AES-256-GCM ─────────────────────────────────────────────────────────────

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * @param plaintext  - Data to encrypt (string or Buffer)
 * @param keyMaterial - 32-byte key or any Buffer/string that will be hashed to 32 bytes
 * @param aad        - Optional Additional Authenticated Data (not encrypted, but authenticated)
 */
export function aesGcmEncrypt(
  plaintext: string | Buffer,
  keyMaterial: Buffer | string,
  aad?: Buffer,
): AesGcmEncryptResult {
  const key = deriveKeyBuffer(keyMaterial);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const plaintextBuf =
    typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;

  const cipher = crypto.createCipheriv("aes-256-gcm" as CipherGCMTypes, key, iv, {
    authTagLength: AES_GCM_TAG_LENGTH,
  });

  if (aad) cipher.setAAD(aad, { plaintextLength: plaintextBuf.length });

  const encrypted = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Clear sensitive material
  zeroFill(key);

  return {
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    ...(aad && { aad: aad.toString("base64") }),
  };
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * Throws if the auth tag does not match (tampered ciphertext or wrong key).
 */
export function aesGcmDecrypt(
  result: AesGcmEncryptResult,
  keyMaterial: Buffer | string,
): Buffer {
  const key = deriveKeyBuffer(keyMaterial);
  const iv = Buffer.from(result.iv, "base64");
  const tag = Buffer.from(result.tag, "base64");
  const ciphertext = Buffer.from(result.ciphertext, "base64");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm" as CipherGCMTypes,
    key,
    iv,
    { authTagLength: AES_GCM_TAG_LENGTH },
  );
  decipher.setAuthTag(tag);

  if (result.aad) {
    const aad = Buffer.from(result.aad, "base64");
    decipher.setAAD(aad, { plaintextLength: ciphertext.length });
  }

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  zeroFill(key);
  return plaintext;
}

// ─── AES-256-CBC (for legacy compatibility) ───────────────────────────────────

/**
 * Encrypt with AES-256-CBC.
 * Prefer GCM for new data — CBC does not provide authentication.
 */
export function aesCbcEncrypt(
  plaintext: string | Buffer,
  keyMaterial: Buffer | string,
): AesCbcEncryptResult {
  const key = deriveKeyBuffer(keyMaterial);
  const iv = randomBytes(AES_CBC_IV_LENGTH);
  const plaintextBuf =
    typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);

  zeroFill(key);
  return {
    algorithm: "AES-256-CBC",
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

export function aesCbcDecrypt(
  result: AesCbcEncryptResult,
  keyMaterial: Buffer | string,
): Buffer {
  const key = deriveKeyBuffer(keyMaterial);
  const iv = Buffer.from(result.iv, "base64");
  const ciphertext = Buffer.from(result.ciphertext, "base64");

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  zeroFill(key);
  return plaintext;
}

// ─── RSA-OAEP ────────────────────────────────────────────────────────────────

/**
 * Encrypt a small payload (e.g. a symmetric key) with an RSA public key
 * using OAEP padding and SHA-256 as the hash function.
 *
 * @param plaintext - Data to encrypt (typically a symmetric key, max ~190 bytes for RSA-2048)
 * @param publicKeyPem - Recipient's RSA public key in PEM format
 */
export function rsaOaepEncrypt(
  plaintext: Buffer | string,
  publicKeyPem: string,
): RsaEncryptResult {
  const data =
    typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;

  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    data,
  );

  return {
    algorithm: "RSA-OAEP-SHA256",
    ciphertext: encrypted.toString("base64"),
  };
}

/**
 * Decrypt RSA-OAEP ciphertext with an RSA private key.
 */
export function rsaOaepDecrypt(
  result: RsaEncryptResult,
  privateKeyPem: string,
): Buffer {
  return crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(result.ciphertext, "base64"),
  );
}

// ─── RSA-PSS Signing ─────────────────────────────────────────────────────────

/**
 * Sign data with RSA-PSS (PKCS#1 v2.2) and SHA-256.
 * Returns a base64-encoded signature.
 */
export function rsaPssSign(data: Buffer | string, privateKeyPem: string): SignatureResult {
  const payload =
    typeof data === "string" ? Buffer.from(data, "utf8") : data;

  const sign = crypto.createSign("SHA256");
  sign.update(payload);
  sign.end();

  const signature = sign.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });

  return {
    algorithm: "RSA-PSS-SHA256",
    signature: signature.toString("base64"),
  };
}

/**
 * Verify an RSA-PSS signature.
 */
export function rsaPssVerify(
  data: Buffer | string,
  result: SignatureResult,
  publicKeyPem: string,
): boolean {
  const payload =
    typeof data === "string" ? Buffer.from(data, "utf8") : data;

  const verify = crypto.createVerify("SHA256");
  verify.update(payload);
  verify.end();

  try {
    return verify.verify(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      Buffer.from(result.signature, "base64"),
    );
  } catch {
    return false;
  }
}

// ─── ECDSA ────────────────────────────────────────────────────────────────────

/**
 * Sign data with ECDSA using a named curve (P-256, P-384, or P-521).
 */
export function ecdsaSign(
  data: Buffer | string,
  privateKeyPem: string,
  hashAlgorithm: "SHA256" | "SHA384" | "SHA512" = "SHA256",
): SignatureResult {
  const payload =
    typeof data === "string" ? Buffer.from(data, "utf8") : data;

  const sign = crypto.createSign(hashAlgorithm);
  sign.update(payload);
  sign.end();

  const signature = sign.sign(privateKeyPem);
  return {
    algorithm: `ECDSA-${hashAlgorithm}`,
    signature: signature.toString("base64"),
  };
}

/**
 * Verify an ECDSA signature.
 */
export function ecdsaVerify(
  data: Buffer | string,
  result: SignatureResult,
  publicKeyPem: string,
): boolean {
  const payload =
    typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const hashAlgo = result.algorithm.replace("ECDSA-", "") as
    | "SHA256"
    | "SHA384"
    | "SHA512";

  const verify = crypto.createVerify(hashAlgo);
  verify.update(payload);
  verify.end();

  try {
    return verify.verify(publicKeyPem, Buffer.from(result.signature, "base64"));
  } catch {
    return false;
  }
}

// ─── HMAC ────────────────────────────────────────────────────────────────────

/**
 * Compute an HMAC-SHA-256 (default) or HMAC-SHA-384/512 over a message.
 * Returns base64-encoded MAC.
 */
export function hmac(
  data: Buffer | string,
  keyMaterial: Buffer | string,
  algorithm: "sha256" | "sha384" | "sha512" = "sha256",
): string {
  const key =
    typeof keyMaterial === "string"
      ? Buffer.from(keyMaterial, "base64")
      : keyMaterial;
  const payload =
    typeof data === "string" ? Buffer.from(data, "utf8") : data;

  return crypto.createHmac(algorithm, key).update(payload).digest("base64");
}

/**
 * Verify an HMAC tag in constant time.
 */
export function hmacVerify(
  data: Buffer | string,
  mac: string,
  keyMaterial: Buffer | string,
  algorithm: "sha256" | "sha384" | "sha512" = "sha256",
): boolean {
  const expected = hmac(data, keyMaterial, algorithm);
  return safeCompare(Buffer.from(expected, "base64"), Buffer.from(mac, "base64"));
}

// ─── HKDF (Key Derivation) ────────────────────────────────────────────────────

/**
 * Derive key material from an input key material (IKM) using HKDF (RFC 5869).
 * Suitable for deriving purpose-specific keys from a master key.
 *
 * @param ikm    - Input Key Material (e.g. master key bytes)
 * @param length - Desired output key length in bytes (max 255 * hashLen)
 * @param info   - Context / application-specific info label
 * @param salt   - Optional salt; if omitted, a random 32-byte salt is generated
 */
export function hkdfDerive(
  ikm: Buffer | string,
  length: number,
  info: Buffer = HKDF_INFO_ENCRYPTION,
  salt?: Buffer,
): HkdfResult {
  const ikmBuf = typeof ikm === "string" ? Buffer.from(ikm, "base64") : ikm;
  const saltBuf = salt ?? randomBytes(32);

  const derivedKey = crypto.hkdfSync("sha256", ikmBuf, saltBuf, info, length);

  return {
    key: Buffer.from(derivedKey),
    salt: saltBuf.toString("base64"),
    info: info.toString("base64"),
  };
}

// ─── PBKDF2 ───────────────────────────────────────────────────────────────────

/**
 * Derive key material from a passphrase using PBKDF2-HMAC-SHA-256.
 * For HSM PIN / custodian passphrase hardening.
 *
 * @param passphrase - User-supplied passphrase
 * @param salt       - Random salt (min 16 bytes)
 * @param iterations - Iteration count (min 100,000 per NIST SP 800-132)
 * @param keyLength  - Output length in bytes (default 32 for AES-256)
 */
export function pbkdf2(
  passphrase: string,
  salt: Buffer,
  iterations: number = 310_000,
  keyLength: number = 32,
): Buffer {
  if (iterations < 100_000) {
    throw new Error("pbkdf2: iteration count below NIST minimum (100,000)");
  }
  return crypto.pbkdf2Sync(passphrase, salt, iterations, keyLength, "sha256");
}

// ─── Key Generation ───────────────────────────────────────────────────────────

/**
 * Generate a cryptographically strong symmetric key.
 * @param bits - Key size in bits: 128, 192, or 256
 */
export function generateSymmetricKey(bits: 128 | 192 | 256 = 256): Buffer {
  return randomBytes(bits / 8);
}

/**
 * Generate an RSA key pair with the specified bit length.
 * FIPS 140-2 requires RSA ≥ 2048 bits.
 */
export function generateRsaKeyPair(
  bits: 2048 | 3072 | 4096 = 3072,
): KeyPairResult {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: bits,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Export public key as DER for compact storage
  const pubKeyObj = crypto.createPublicKey(publicKey as string);
  const publicKeyDer = pubKeyObj.export({ type: "spki", format: "der" });

  return {
    algorithm: `RSA-${bits}`,
    publicKey: publicKey as string,
    privateKey: privateKey as string,
    publicKeyDer: publicKeyDer.toString("base64"),
  };
}

/**
 * Generate an EC key pair on a named NIST curve.
 * FIPS 140-2 approved curves: P-256, P-384, P-521.
 */
export function generateEcKeyPair(
  namedCurve: "P-256" | "P-384" | "P-521" = "P-384",
): KeyPairResult {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const pubKeyObj = crypto.createPublicKey(publicKey as string);
  const publicKeyDer = pubKeyObj.export({ type: "spki", format: "der" });

  return {
    algorithm: `EC-${namedCurve}`,
    publicKey: publicKey as string,
    privateKey: privateKey as string,
    publicKeyDer: publicKeyDer.toString("base64"),
  };
}

// ─── Key Wrapping ─────────────────────────────────────────────────────────────

/**
 * Wrap (encrypt) a symmetric key with a wrapping key using AES-256-GCM.
 * This is the software equivalent of CKM_AES_KEY_WRAP.
 *
 * @param keyToWrap     - The raw symmetric key bytes to protect
 * @param wrappingKey   - 32-byte wrapping key material
 * @param wrappingKeyId - Label for the wrapping key (for audit trail)
 */
export function wrapKey(
  keyToWrap: Buffer,
  wrappingKey: Buffer | string,
  wrappingKeyId: string,
): WrappedKeyResult {
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const wkBuf =
    typeof wrappingKey === "string"
      ? Buffer.from(wrappingKey, "base64")
      : wrappingKey;

  const key = deriveKeyBuffer(wkBuf);
  const cipher = crypto.createCipheriv("aes-256-gcm" as CipherGCMTypes, key, iv, {
    authTagLength: AES_GCM_TAG_LENGTH,
  });

  const wrapped = Buffer.concat([cipher.update(keyToWrap), cipher.final()]);
  const tag = cipher.getAuthTag();
  zeroFill(key);

  return {
    algorithm: "AES-256-GCM",
    wrappingKeyId,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    wrappedKey: wrapped.toString("base64"),
  };
}

/**
 * Unwrap (decrypt) a wrapped symmetric key.
 * Throws if the auth tag does not match.
 */
export function unwrapKey(
  wrapped: WrappedKeyResult,
  wrappingKey: Buffer | string,
): Buffer {
  const iv = Buffer.from(wrapped.iv, "base64");
  const tag = Buffer.from(wrapped.tag, "base64");
  const ciphertext = Buffer.from(wrapped.wrappedKey, "base64");
  const wkBuf =
    typeof wrappingKey === "string"
      ? Buffer.from(wrappingKey, "base64")
      : wrappingKey;

  const key = deriveKeyBuffer(wkBuf);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm" as CipherGCMTypes,
    key,
    iv,
    { authTagLength: AES_GCM_TAG_LENGTH },
  );
  decipher.setAuthTag(tag);

  const unwrapped = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  zeroFill(key);
  return unwrapped;
}

// ─── Shamir-like Secret Sharing (M-of-N escrow) ───────────────────────────────

/**
 * Minimal XOR-based secret sharing for M=N case (every share needed).
 * For a proper M-of-N implementation in production, integrate a proper
 * library or the HSM's secret sharing mechanism.
 *
 * This implementation splits a secret into N parts where ALL N shares are
 * required to reconstruct the secret (XOR splitting).  For true M-of-N
 * (threshold < totalShares), connect to an HSM that supports CKM_XOR_BASE_AND_DATA.
 */
export function splitSecret(
  secret: Buffer,
  shares: number,
): Buffer[] {
  if (shares < 2) throw new Error("splitSecret: shares must be at least 2");

  const result: Buffer[] = [];

  // Generate N-1 random shares
  let xorSum = Buffer.alloc(secret.length, 0);
  for (let i = 0; i < shares - 1; i++) {
    const share = randomBytes(secret.length);
    result.push(share);
    for (let j = 0; j < secret.length; j++) {
      xorSum[j] ^= share[j];
    }
  }

  // Last share = secret XOR all other shares
  const lastShare = Buffer.alloc(secret.length);
  for (let j = 0; j < secret.length; j++) {
    lastShare[j] = secret[j] ^ xorSum[j];
  }
  result.push(lastShare);

  return result;
}

/**
 * Reconstruct a secret from all N XOR shares.
 * All shares must be provided (matches splitSecret's N-of-N scheme).
 */
export function combineShares(shares: Buffer[]): Buffer {
  if (shares.length < 2) throw new Error("combineShares: at least 2 shares required");

  const result = Buffer.alloc(shares[0].length, 0);
  for (const share of shares) {
    if (share.length !== result.length) {
      throw new Error("combineShares: all shares must have identical length");
    }
    for (let j = 0; j < result.length; j++) {
      result[j] ^= share[j];
    }
  }
  return result;
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

/**
 * Encode binary data as URL-safe base64 (no padding).
 */
export function toBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Decode URL-safe base64 back to Buffer.
 */
export function fromBase64Url(s: string): Buffer {
  const standard = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(standard, "base64");
}

/**
 * Hash a value with SHA-256 and return as a hex string.
 * Useful for deriving stable key IDs from key material.
 */
export function sha256Hex(data: Buffer | string): string {
  return crypto
    .createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data) : data)
    .digest("hex");
}
