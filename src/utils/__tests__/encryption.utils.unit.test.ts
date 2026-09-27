import * as crypto from "crypto";
import { EncryptionUtil, EncryptedValue, EncryptionKeyset } from "../encryption.utils";

describe("EncryptionUtil", () => {
  // Setup test keys
  const testKey1 = crypto.randomBytes(32).toString("hex");
  const testKey2 = crypto.randomBytes(32).toString("hex");
  const testKeyset: EncryptionKeyset = {
    currentVersion: "v1",
    keys: {
      v1: testKey1,
      v2: testKey2,
    },
  };

  beforeEach(async () => {
    // Mock the key resolver to use test keys
    EncryptionUtil.setKeyResolver(async () => testKeyset);
  });

  afterEach(() => {
    EncryptionUtil.clearCache();
  });

  describe("encrypt and decrypt", () => {
    it("should encrypt and decrypt a string to the original value", async () => {
      const originalValue = "sensitive@email.com";

      const encrypted = await EncryptionUtil.encrypt(originalValue);
      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(originalValue);

      const decrypted = await EncryptionUtil.decrypt(encrypted!);
      expect(decrypted).toBe(originalValue);
    });

    it("should handle long strings", async () => {
      const longString = "a".repeat(5000) + "@example.com";

      const encrypted = await EncryptionUtil.encrypt(longString);
      const decrypted = await EncryptionUtil.decrypt(encrypted!);

      expect(decrypted).toBe(longString);
    });

    it("should handle special characters", async () => {
      const specialChars = 'test@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';

      const encrypted = await EncryptionUtil.encrypt(specialChars);
      const decrypted = await EncryptionUtil.decrypt(encrypted!);

      expect(decrypted).toBe(specialChars);
    });

    it("should handle unicode characters", async () => {
      const unicodeString = "Привет мир 你好世界 مرحبا بالعالم 🎉🔐";

      const encrypted = await EncryptionUtil.encrypt(unicodeString);
      const decrypted = await EncryptionUtil.decrypt(encrypted!);

      expect(decrypted).toBe(unicodeString);
    });

    it("should return null for null input on encrypt", async () => {
      const encrypted = await EncryptionUtil.encrypt(null);
      expect(encrypted).toBeNull();
    });

    it("should return null for undefined input on encrypt", async () => {
      const encrypted = await EncryptionUtil.encrypt(undefined);
      expect(encrypted).toBeNull();
    });

    it("should return null for empty string on encrypt", async () => {
      const encrypted = await EncryptionUtil.encrypt("");
      expect(encrypted).toBeNull();
    });

    it("should return null for null input on decrypt", async () => {
      const decrypted = await EncryptionUtil.decrypt(null);
      expect(decrypted).toBeNull();
    });

    it("should return null for undefined input on decrypt", async () => {
      const decrypted = await EncryptionUtil.decrypt(undefined);
      expect(decrypted).toBeNull();
    });
  });

  describe("random IV generation", () => {
    it("should generate different ciphertexts for the same plaintext (random IV)", async () => {
      const plaintext = "test-value";

      const encrypted1 = await EncryptionUtil.encrypt(plaintext);
      const encrypted2 = await EncryptionUtil.encrypt(plaintext);

      // Ciphertexts should be different because IV is random
      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      const decrypted1 = await EncryptionUtil.decrypt(encrypted1!);
      const decrypted2 = await EncryptionUtil.decrypt(encrypted2!);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });
  });

  describe("wrong key decryption", () => {
    it("should throw when decrypting with wrong key", async () => {
      const originalValue = "secret-data";
      const encrypted = await EncryptionUtil.encrypt(originalValue);

      // Change the key
      const wrongKeyset: EncryptionKeyset = {
        currentVersion: "v1",
        keys: {
          v1: crypto.randomBytes(32).toString("hex"), // Different key
        },
      };

      EncryptionUtil.setKeyResolver(async () => wrongKeyset);

      // Attempting to decrypt with wrong key should throw
      await expect(EncryptionUtil.decrypt(encrypted!)).rejects.toThrow();
    });
  });

  describe("tampered ciphertext validation", () => {
    it("should throw when authentication tag validation fails (tampered ciphertext)", async () => {
      const originalValue = "important-data";
      const encrypted = await EncryptionUtil.encrypt(originalValue);

      // Parse the encrypted value to tamper with it
      const parts = encrypted!.split(":");
      expect(parts.length).toBe(4);

      const [version, iv, tag, ciphertext] = parts;

      // Decode ciphertext and flip a bit
      const ciphertextBuffer = Buffer.from(ciphertext, "base64");
      const tamperedByte = ciphertextBuffer[0] ^ 0xff; // Flip all bits of first byte
      ciphertextBuffer[0] = tamperedByte;

      const tamperedCiphertext = ciphertextBuffer.toString("base64");
      const tamperedEncrypted = `${version}:${iv}:${tag}:${tamperedCiphertext}`;

      // Decryption should fail due to authentication tag validation
      await expect(EncryptionUtil.decrypt(tamperedEncrypted)).rejects.toThrow();
    });

    it("should throw when authentication tag is tampered", async () => {
      const originalValue = "important-data";
      const encrypted = await EncryptionUtil.encrypt(originalValue);

      const parts = encrypted!.split(":");
      const [version, iv, tag, ciphertext] = parts;

      // Tamper with the authentication tag
      const tagBuffer = Buffer.from(tag, "base64");
      const tamperedTagByte = tagBuffer[0] ^ 0xff;
      tagBuffer[0] = tamperedTagByte;

      const tamperedTag = tagBuffer.toString("base64");
      const tamperedEncrypted = `${version}:${iv}:${tamperedTag}:${ciphertext}`;

      // Decryption should fail due to authentication tag validation
      await expect(EncryptionUtil.decrypt(tamperedEncrypted)).rejects.toThrow();
    });

    it("should throw when IV is tampered", async () => {
      const originalValue = "important-data";
      const encrypted = await EncryptionUtil.encrypt(originalValue);

      const parts = encrypted!.split(":");
      const [version, iv, tag, ciphertext] = parts;

      // Tamper with the IV
      const ivBuffer = Buffer.from(iv, "base64");
      const tamperedIvByte = ivBuffer[0] ^ 0xff;
      ivBuffer[0] = tamperedIvByte;

      const tamperedIv = ivBuffer.toString("base64");
      const tamperedEncrypted = `${version}:${tamperedIv}:${tag}:${ciphertext}`;

      // Decryption should fail due to authentication tag validation
      // (because decryption will produce garbage that doesn't match the tag)
      await expect(EncryptionUtil.decrypt(tamperedEncrypted)).rejects.toThrow();
    });
  });

  describe("invalid encrypted payload format", () => {
    it("should throw on malformed ciphertext format", async () => {
      const malformed = "invalid-format-not-matching-spec";

      await expect(EncryptionUtil.decrypt(malformed)).rejects.toThrow(
        "Invalid encrypted payload"
      );
    });

    it("should throw on invalid JSON payload", async () => {
      const invalidJson = '{"invalid": "json without required fields"}';

      await expect(EncryptionUtil.decrypt(invalidJson)).rejects.toThrow(
        "Invalid encrypted payload"
      );
    });
  });

  describe("getCurrentKeyVersion", () => {
    it("should return the current key version", async () => {
      const version = await EncryptionUtil.getCurrentKeyVersion();
      expect(version).toBe("v1");
    });
  });

  describe("rotateEncryptedValue", () => {
    it("should re-encrypt a value with the current key", async () => {
      const originalValue = "data-to-rotate";

      // Encrypt with v1
      const encrypted = await EncryptionUtil.encrypt(originalValue);

      // Simulate a key rotation to v2
      const rotatedKeyset: EncryptionKeyset = {
        currentVersion: "v2",
        keys: {
          v1: testKey1,
          v2: testKey2,
        },
      };

      EncryptionUtil.setKeyResolver(async () => rotatedKeyset);

      // Rotate the encrypted value
      const rotated = await EncryptionUtil.rotateEncryptedValue(encrypted);

      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(encrypted); // Should be different (new IV)

      // Should decrypt to the same value
      const decrypted = await EncryptionUtil.decrypt(rotated!);
      expect(decrypted).toBe(originalValue);

      // Check that the new encrypted value uses v2
      const rotatedParts = rotated!.split(":");
      expect(rotatedParts[0]).toBe("v2");
    });

    it("should return null for null input on rotate", async () => {
      const rotated = await EncryptionUtil.rotateEncryptedValue(null);
      expect(rotated).toBeNull();
    });

    it("should return null for undefined input on rotate", async () => {
      const rotated = await EncryptionUtil.rotateEncryptedValue(undefined);
      expect(rotated).toBeNull();
    });
  });

  describe("getPayloadVersion", () => {
    it("should extract the version from an encrypted payload", async () => {
      const value = "test-value";
      const encrypted = await EncryptionUtil.encrypt(value);

      const version = await EncryptionUtil.getPayloadVersion(encrypted);
      expect(version).toBe("v1");
    });

    it("should return null for null input", async () => {
      const version = await EncryptionUtil.getPayloadVersion(null);
      expect(version).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle very short strings", async () => {
      const shortString = "a";

      const encrypted = await EncryptionUtil.encrypt(shortString);
      const decrypted = await EncryptionUtil.decrypt(encrypted!);

      expect(decrypted).toBe(shortString);
    });

    it("should handle strings with only spaces", async () => {
      const spaces = "     ";

      const encrypted = await EncryptionUtil.encrypt(spaces);
      const decrypted = await EncryptionUtil.decrypt(encrypted!);

      expect(decrypted).toBe(spaces);
    });

    it("should handle strings with newlines", async () => {
      const multiline = "line1\nline2\nline3";

      const encrypted = await EncryptionUtil.encrypt(multiline);
      const decrypted = await EncryptionUtil.decrypt(encrypted!);

      expect(decrypted).toBe(multiline);
    });

    it("should handle emails with complex domains", async () => {
      const email = "user+tag@subdomain.example.co.uk";

      const encrypted = await EncryptionUtil.encrypt(email);
      const decrypted = await EncryptionUtil.decrypt(encrypted!);

      expect(decrypted).toBe(email);
    });
  });
});
