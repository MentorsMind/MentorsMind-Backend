/**
 * Integration tests for Encryption at Rest
 */

import { EncryptionUtil } from '../../utils/encryption.utils';
import pool from '../../config/database';

// Mock dependencies
jest.mock('../../config/database');

describe('Encryption at Rest Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    EncryptionUtil.setKeyResolver(async () => ({
      currentVersion: 'v1',
      keys: {
        v1: 'test-key-material-32-bytes-long',
      },
    }));
    EncryptionUtil.clearCache();
  });

  describe('Webhook API Key Encryption', () => {
    it('should encrypt webhook API keys before storage', async () => {
      const apiKey = 'mk_live_1234567890abcdef';
      const encrypted = await EncryptionUtil.encrypt(apiKey);
      
      expect(encrypted).not.toEqual(apiKey);
      expect(encrypted).toContain('aes-256-gcm');
      expect(encrypted).toContain('v1');
    });

    it('should decrypt webhook API keys for use', async () => {
      const apiKey = 'mk_live_1234567890abcdef';
      const encrypted = await EncryptionUtil.encrypt(apiKey);
      const decrypted = await EncryptionUtil.decrypt(encrypted);
      
      expect(decrypted).toEqual(apiKey);
    });

    it('should rotate webhook API keys to new encryption version', async () => {
      EncryptionUtil.setKeyResolver(async () => ({
        currentVersion: 'v1',
        keys: { v1: 'old-key-material-32-bytes-long' },
      }));
      EncryptionUtil.clearCache();

      const apiKey = 'mk_live_1234567890abcdef';
      const oldEncrypted = await EncryptionUtil.encrypt(apiKey);

      EncryptionUtil.setKeyResolver(async () => ({
        currentVersion: 'v2',
        keys: { 
          v1: 'old-key-material-32-bytes-long',
          v2: 'new-key-material-32-bytes-long',
        },
      }));
      EncryptionUtil.clearCache();

      const rotated = await EncryptionUtil.rotateEncryptedValue(oldEncrypted);
      const decrypted = await EncryptionUtil.decrypt(rotated);
      
      expect(decrypted).toEqual(apiKey);
      expect(await EncryptionUtil.getPayloadVersion(rotated)).toEqual('v2');
    });
  });

  describe('OAuth Token Encryption', () => {
    it('should encrypt OAuth access tokens', async () => {
      const accessToken = 'ya29.a0AfH6SMBx_abc123xyz';
      const encrypted = await EncryptionUtil.encrypt(accessToken);
      
      expect(encrypted).not.toEqual(accessToken);
      const decrypted = await EncryptionUtil.decrypt(encrypted);
      expect(decrypted).toEqual(accessToken);
    });

    it('should encrypt OAuth refresh tokens', async () => {
      const refreshToken = '1//0gxyz123abc456';
      const encrypted = await EncryptionUtil.encrypt(refreshToken);
      
      expect(encrypted).not.toEqual(refreshToken);
      const decrypted = await EncryptionUtil.decrypt(encrypted);
      expect(decrypted).toEqual(refreshToken);
    });
  });

  describe('PII Field Encryption', () => {
    it('should encrypt phone numbers', async () => {
      const phone = '+1-555-123-4567';
      const encrypted = await EncryptionUtil.encrypt(phone);
      
      expect(encrypted).not.toEqual(phone);
      const decrypted = await EncryptionUtil.decrypt(encrypted);
      expect(decrypted).toEqual(phone);
    });

    it('should encrypt government ID numbers', async () => {
      const ssn = '123-45-6789';
      const encrypted = await EncryptionUtil.encrypt(ssn);
      
      expect(encrypted).not.toEqual(ssn);
      const decrypted = await EncryptionUtil.decrypt(encrypted);
      expect(decrypted).toEqual(ssn);
    });

    it('should encrypt bank account details', async () => {
      const bankAccount = '****-****-****-1234';
      const encrypted = await EncryptionUtil.encrypt(bankAccount);
      
      expect(encrypted).not.toEqual(bankAccount);
      const decrypted = await EncryptionUtil.decrypt(encrypted);
      expect(decrypted).toEqual(bankAccount);
    });
  });

  describe('Key Rotation', () => {
    it('should handle null values gracefully', async () => {
      const rotated = await EncryptionUtil.rotateEncryptedValue(null);
      expect(rotated).toBeNull();
    });

    it('should handle empty strings gracefully', async () => {
      const rotated = await EncryptionUtil.rotateEncryptedValue('');
      expect(rotated).toBeNull();
    });

    it('should get current key version', async () => {
      const version = await EncryptionUtil.getCurrentKeyVersion();
      expect(version).toBe('v1');
    });

    it('should get payload version from encrypted value', async () => {
      const encrypted = await EncryptionUtil.encrypt('test-value');
      const version = await EncryptionUtil.getPayloadVersion(encrypted);
      expect(version).toBe('v1');
    });
  });
});
