import * as crypto from "crypto";
import { resolveAppSecrets } from "../config/secrets";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const DEFAULT_KEY_VERSION = "v1";

export interface EncryptedValue {
  alg: "aes-256-gcm";
  version: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface EncryptionKeyset {
  currentVersion: string;
  keys: Record<string, string>;
}

let keyResolver: (() => Promise<EncryptionKeyset>) | null = null;
let cachedKeyset: EncryptionKeyset | null = null;

function deriveKey(rawKey: string): Buffer {
  return crypto.createHash("sha256").update(rawKey).digest();
}

function parseEncryptedValue(value: string): EncryptedValue {
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as Partial<EncryptedValue>;
      if (
        parsed.alg !== ALGORITHM ||
        !parsed.version ||
        !parsed.iv ||
        !parsed.tag ||
        !parsed.ciphertext
      ) {
        throw new Error("Invalid encrypted payload (JSON)");
      }
      return parsed as EncryptedValue;
    } catch {
      throw new Error("Invalid encrypted payload (JSON)");
    }
  }

  const parts = value.split(":");
  if (parts.length === 4) {
    const [version, iv, tag, ciphertext] = parts;
    return {
      alg: ALGORITHM,
      version,
      iv,
      tag,
      ciphertext,
    };
  }

  throw new Error("Invalid encrypted payload (format mismatch)");
}

async function defaultKeyResolver(): Promise<EncryptionKeyset> {
  const secrets = await resolveAppSecrets();
  const keysFromSecrets = secrets.PII_ENCRYPTION_KEYS
    ? (JSON.parse(secrets.PII_ENCRYPTION_KEYS) as Record<string, string>)
    : {};

  const envFallbackKey = process.env.PII_ENCRYPTION_KEY;
  const keys =
    Object.keys(keysFromSecrets).length > 0
      ? keysFromSecrets
      : envFallbackKey
        ? { [DEFAULT_KEY_VERSION]: envFallbackKey }
        : {};

  const currentVersion =
    secrets.PII_ENCRYPTION_CURRENT_KEY_VERSION ||
    process.env.PII_ENCRYPTION_CURRENT_KEY_VERSION ||
    Object.keys(keys)[0] ||
    DEFAULT_KEY_VERSION;

  if (!keys[currentVersion]) {
    throw new Error(`Missing encryption key material for version "${currentVersion}"`);
  }

  return {
    currentVersion,
    keys,
  };
}

async function getKeyset(forceRefresh = false): Promise<EncryptionKeyset> {
  if (!forceRefresh && cachedKeyset) {
    return cachedKeyset;
  }

  const resolved = await (keyResolver ?? defaultKeyResolver)();
  cachedKeyset = resolved;
  return resolved;
}

async function encryptWithVersion(
  plaintext: string,
  version: string,
  rawKey: string,
): Promise<string> {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(rawKey), iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const ivB64 = iv.toString("base64");
  const tagB64 = cipher.getAuthTag().toString("base64");
  const ciphertextB64 = ciphertext.toString("base64");

  return `${version}:${ivB64}:${tagB64}:${ciphertextB64}`;
}

export const EncryptionUtil = {
  setKeyResolver(resolver: () => Promise<EncryptionKeyset>): void {
    keyResolver = resolver;
    cachedKeyset = null;
  },

  clearCache(): void {
    cachedKeyset = null;
  },

  async getCurrentKeyVersion(): Promise<string> {
    const keyset = await getKeyset();
    return keyset.currentVersion;
  },

  async encrypt(value: string | null | undefined): Promise<string | null> {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const keyset = await getKeyset();
    return encryptWithVersion(
      value,
      keyset.currentVersion,
      keyset.keys[keyset.currentVersion],
    );
  },

  async decrypt(value: string | null | undefined): Promise<string | null> {
    if (!value) {
      return null;
    }

    const payload = parseEncryptedValue(value);
    const keyset = await getKeyset();
    const rawKey = keyset.keys[payload.version];

    if (!rawKey) {
      throw new Error(`No decryption key available for version "${payload.version}"`);
    }

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      deriveKey(rawKey),
      Buffer.from(payload.iv, "base64"),
      { authTagLength: AUTH_TAG_LENGTH_BYTES },
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]);

    return plaintext.toString("utf8");
  },

  async rotateEncryptedValue(value: string | null | undefined): Promise<string | null> {
    if (!value) {
      return null;
    }

    const plaintext = await this.decrypt(value);
    return this.encrypt(plaintext);
  },

  async getPayloadVersion(value: string | null | undefined): Promise<string | null> {
    if (!value) {
      return null;
    }
    return parseEncryptedValue(value).version;
  },

  async reEncrypt(
    value: string,
    oldKey: string,
    newKey: string,
    newVersion: string,
  ): Promise<string> {
    const payload = parseEncryptedValue(value);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      deriveKey(oldKey),
      Buffer.from(payload.iv, "base64"),
      { authTagLength: AUTH_TAG_LENGTH_BYTES },
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]);

    return encryptWithVersion(plaintext.toString("utf8"), newVersion, newKey);
  },
};
