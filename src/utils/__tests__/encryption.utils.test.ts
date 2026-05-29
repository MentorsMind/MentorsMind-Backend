import { EncryptionUtil } from "../encryption.utils";

describe("EncryptionUtil", () => {
  beforeEach(() => {
    EncryptionUtil.setKeyResolver(async () => ({
      currentVersion: "v2",
      keys: {
        v1: "legacy-key-material",
        v2: "current-key-material",
      },
    }));
    EncryptionUtil.clearCache();
  });

  it("encrypts and decrypts a value round-trip", async () => {
    const encrypted = await EncryptionUtil.encrypt("sensitive-value");
    const decrypted = await EncryptionUtil.decrypt(encrypted);

    expect(encrypted).not.toEqual("sensitive-value");
    expect(decrypted).toEqual("sensitive-value");
  });

  it("rotates older ciphertext to the current key version", async () => {
    EncryptionUtil.setKeyResolver(async () => ({
      currentVersion: "v1",
      keys: {
        v1: "legacy-key-material",
        v2: "current-key-material",
      },
    }));
    EncryptionUtil.clearCache();

    const legacyEncrypted = await EncryptionUtil.encrypt("rotate-me");

    EncryptionUtil.setKeyResolver(async () => ({
      currentVersion: "v2",
      keys: {
        v1: "legacy-key-material",
        v2: "current-key-material",
      },
    }));
    EncryptionUtil.clearCache();

    const rotated = await EncryptionUtil.rotateEncryptedValue(legacyEncrypted);

    await expect(EncryptionUtil.decrypt(rotated)).resolves.toEqual("rotate-me");
    await expect(EncryptionUtil.getPayloadVersion(rotated)).resolves.toEqual("v2");
  });
});
