/**
 * Integration test for UserModel PII encryption/decryption round-trip.
 *
 * Tests verify that:
 * 1. Values encrypted during user creation are correctly decrypted by getSensitiveFields
 * 2. All sensitive field values match their originals after round-trip
 * 3. pii_encryption_version is set to the current key version on write
 * 4. Null sensitive fields are stored as null (no empty-string encryption)
 * 5. JSON object fields (bank details, payment methods) serialize/deserialize correctly
 *
 * This test exercises the full encryption path without mocking EncryptionUtil,
 * ensuring that bugs in key management are caught.
 */

import pool from '../../../src/config/database';
import { UserModel, UserRow, CreateUserInput, UserSensitiveFields } from '../../../src/models/user.model';
import { EncryptionUtil } from '../../../src/utils/encryption.utils';

/**
 * Helper: Set up encryption with a test key for consistent round-trip testing.
 */
async function setupTestEncryption() {
  // Use a fixed test key for reproducibility
  const testKey = 'test-encryption-key-32-bytes-long!';
  
  EncryptionUtil.setKeyResolver(async () => ({
    currentVersion: 'v1',
    keys: {
      v1: testKey,
    },
  }));

  // Clear any cached keyset to ensure fresh resolution
  EncryptionUtil.clearCache();
}

/**
 * Helper: Clean up created user rows after each test.
 */
async function cleanupUsers(userIds: string[]) {
  if (userIds.length === 0) return;

  const placeholders = userIds.map((_, idx) => `$${idx + 1}`).join(',');
  await pool.query(
    `DELETE FROM users WHERE id IN (${placeholders})`,
    userIds,
  );
}

describe('UserModel PII Encryption/Decryption Integration', () => {
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await setupTestEncryption();
  });

  afterEach(async () => {
    await cleanupUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Round-trip encryption/decryption', () => {
    it('should encrypt and decrypt all sensitive fields correctly', async () => {
      // Arrange: Create a user with all sensitive fields
      const input: CreateUserInput = {
        email: 'test-pii@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'user',
        status: 'active',
        sensitive: {
          ssn: '123-45-6789',
          passportNumber: 'P12345678',
          governmentIdNumber: 'ID-98765432',
          phoneNumber: '+1234567890',
          dateOfBirth: '1990-05-15',
          bankAccountDetails: {
            accountNumber: '1234567890',
            routingNumber: '987654321',
            accountType: 'checking',
          },
          paymentMethodDetails: {
            cardToken: 'tok_visa_1234',
            brand: 'visa',
            last4: '4242',
          },
        },
      };

      // Act: Create the user
      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      // Verify ciphertext columns are populated
      expect(createdUser.ssn_encrypted).toBeTruthy();
      expect(createdUser.passport_number_encrypted).toBeTruthy();
      expect(createdUser.government_id_number_encrypted).toBeTruthy();
      expect(createdUser.phone_number_encrypted).toBeTruthy();
      expect(createdUser.date_of_birth_encrypted).toBeTruthy();
      expect(createdUser.bank_account_details_encrypted).toBeTruthy();
      expect(createdUser.payment_method_details_encrypted).toBeTruthy();

      // Act: Read the user back and decrypt
      const fetchedUser = await UserModel.findById(createdUser.id);
      expect(fetchedUser).toBeTruthy();

      const decrypted = await UserModel.decryptSensitiveFields(fetchedUser!);

      // Assert: All decrypted values match the originals
      expect(decrypted.ssn).toBe(input.sensitive!.ssn);
      expect(decrypted.passportNumber).toBe(input.sensitive!.passportNumber);
      expect(decrypted.governmentIdNumber).toBe(input.sensitive!.governmentIdNumber);
      expect(decrypted.phoneNumber).toBe(input.sensitive!.phoneNumber);
      expect(decrypted.dateOfBirth).toBe(input.sensitive!.dateOfBirth);
      expect(decrypted.bankAccountDetails).toEqual(input.sensitive!.bankAccountDetails);
      expect(decrypted.paymentMethodDetails).toEqual(input.sensitive!.paymentMethodDetails);
    });

    it('should handle partial sensitive fields correctly', async () => {
      // Arrange: Create a user with only some sensitive fields
      const input: CreateUserInput = {
        email: 'partial-pii@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
        sensitive: {
          ssn: '987-65-4321',
          phoneNumber: '+9876543210',
          // Other fields not provided
        },
      };

      // Act: Create the user
      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      // Assert: Provided fields are encrypted, unprovided are null
      expect(createdUser.ssn_encrypted).toBeTruthy();
      expect(createdUser.phone_number_encrypted).toBeTruthy();
      expect(createdUser.passport_number_encrypted).toBeNull();
      expect(createdUser.government_id_number_encrypted).toBeNull();
      expect(createdUser.date_of_birth_encrypted).toBeNull();
      expect(createdUser.bank_account_details_encrypted).toBeNull();
      expect(createdUser.payment_method_details_encrypted).toBeNull();

      // Act: Fetch and decrypt
      const fetchedUser = await UserModel.findById(createdUser.id);
      const decrypted = await UserModel.decryptSensitiveFields(fetchedUser!);

      // Assert: Decrypted values match
      expect(decrypted.ssn).toBe(input.sensitive!.ssn);
      expect(decrypted.phoneNumber).toBe(input.sensitive!.phoneNumber);
      expect(decrypted.passportNumber).toBeNull();
      expect(decrypted.governmentIdNumber).toBeNull();
    });

    it('should store null for empty sensitive fields (no empty-string encryption)', async () => {
      // Arrange: Create a user with empty strings (should be treated as null)
      const input: CreateUserInput = {
        email: 'empty-fields@example.com',
        firstName: 'Empty',
        lastName: 'Fields',
        sensitive: {
          ssn: '', // Empty string should result in null
          phoneNumber: '', // Empty string should result in null
        },
      };

      // Act: Create the user
      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      // Assert: Empty strings are stored as null, not encrypted
      expect(createdUser.ssn_encrypted).toBeNull();
      expect(createdUser.phone_number_encrypted).toBeNull();

      // Act: Fetch and decrypt
      const fetchedUser = await UserModel.findById(createdUser.id);
      const decrypted = await UserModel.decryptSensitiveFields(fetchedUser!);

      // Assert: Decrypted values are null
      expect(decrypted.ssn).toBeNull();
      expect(decrypted.phoneNumber).toBeNull();
    });
  });

  describe('Key version tracking', () => {
    it('should set pii_encryption_version to current key version on creation', async () => {
      // Arrange
      const input: CreateUserInput = {
        email: 'version-test-1@example.com',
        firstName: 'Version',
        lastName: 'Test',
        sensitive: {
          ssn: '111-22-3333',
        },
      };

      // Act: Create the user
      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      // Assert: Key version is set to the current version
      const currentVersion = await EncryptionUtil.getCurrentKeyVersion();
      expect(createdUser.pii_encryption_version).toBe(currentVersion);
      expect(createdUser.pii_encryption_version).toBe('v1');
    });

    it('should update pii_encryption_version when sensitive fields are updated', async () => {
      // Arrange: Create a user first
      const input: CreateUserInput = {
        email: 'version-test-2@example.com',
        firstName: 'Version',
        lastName: 'Update',
        sensitive: {
          ssn: '111-22-3333',
        },
      };

      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      const initialVersion = createdUser.pii_encryption_version;

      // Act: Update a sensitive field
      const updatedUser = await UserModel.updateSensitiveFields(createdUser.id, {
        sensitive: {
          phoneNumber: '+1111111111',
        },
      });

      // Assert: Key version is maintained (or updated to current)
      expect(updatedUser).toBeTruthy();
      expect(updatedUser!.pii_encryption_version).toBe(initialVersion);
      expect(updatedUser!.phone_number_encrypted).toBeTruthy();

      // Act: Verify the updated phone number decrypts correctly
      const decrypted = await UserModel.decryptSensitiveFields(updatedUser!);
      expect(decrypted.phoneNumber).toBe('+1111111111');
    });
  });

  describe('Complex object serialization', () => {
    it('should correctly serialize and deserialize bank account details', async () => {
      // Arrange
      const bankDetails = {
        accountNumber: '9876543210',
        routingNumber: '123456789',
        accountType: 'savings',
        bankName: 'Test Bank',
        accountHolderName: 'John Doe',
      };

      const input: CreateUserInput = {
        email: 'bank-details@example.com',
        firstName: 'Bank',
        lastName: 'Test',
        sensitive: {
          bankAccountDetails: bankDetails,
        },
      };

      // Act: Create and fetch
      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      const fetchedUser = await UserModel.findById(createdUser.id);
      const decrypted = await UserModel.decryptSensitiveFields(fetchedUser!);

      // Assert: Bank details match exactly
      expect(decrypted.bankAccountDetails).toEqual(bankDetails);
      expect(decrypted.bankAccountDetails!.accountNumber).toBe(bankDetails.accountNumber);
      expect(decrypted.bankAccountDetails!.bankName).toBe(bankDetails.bankName);
    });

    it('should correctly serialize and deserialize payment method details', async () => {
      // Arrange
      const paymentDetails = {
        cardToken: 'tok_mastercard_9999',
        brand: 'mastercard',
        last4: '5555',
        expiryMonth: '12',
        expiryYear: '2025',
      };

      const input: CreateUserInput = {
        email: 'payment-details@example.com',
        firstName: 'Payment',
        lastName: 'Test',
        sensitive: {
          paymentMethodDetails: paymentDetails,
        },
      };

      // Act: Create and fetch
      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      const fetchedUser = await UserModel.findById(createdUser.id);
      const decrypted = await UserModel.decryptSensitiveFields(fetchedUser!);

      // Assert: Payment details match exactly
      expect(decrypted.paymentMethodDetails).toEqual(paymentDetails);
      expect(decrypted.paymentMethodDetails!.cardToken).toBe(paymentDetails.cardToken);
      expect(decrypted.paymentMethodDetails!.expiryYear).toBe(paymentDetails.expiryYear);
    });

    it('should handle empty objects as null (no encryption of empty objects)', async () => {
      // Arrange
      const input: CreateUserInput = {
        email: 'empty-objects@example.com',
        firstName: 'Empty',
        lastName: 'Objects',
        sensitive: {
          bankAccountDetails: {}, // Empty object
          paymentMethodDetails: {}, // Empty object
        },
      };

      // Act: Create the user
      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      // Assert: Empty objects result in null ciphertext
      expect(createdUser.bank_account_details_encrypted).toBeNull();
      expect(createdUser.payment_method_details_encrypted).toBeNull();

      // Act: Fetch and decrypt
      const fetchedUser = await UserModel.findById(createdUser.id);
      const decrypted = await UserModel.decryptSensitiveFields(fetchedUser!);

      // Assert: Decrypted values are null
      expect(decrypted.bankAccountDetails).toBeNull();
      expect(decrypted.paymentMethodDetails).toBeNull();
    });
  });

  describe('Encryption format and integrity', () => {
    it('should produce valid AES-256-GCM encrypted ciphertext', async () => {
      // Arrange
      const input: CreateUserInput = {
        email: 'encryption-format@example.com',
        firstName: 'Format',
        lastName: 'Test',
        sensitive: {
          ssn: '555-66-7777',
        },
      };

      // Act: Create the user
      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      // Assert: Ciphertext follows the expected format (version:iv:tag:ciphertext in base64)
      const ciphertext = createdUser.ssn_encrypted!;
      const parts = ciphertext.split(':');
      expect(parts.length).toBe(4);

      const [version, iv, tag, ciphertextPart] = parts;
      expect(version).toBe('v1');

      // Verify base64 encoding
      expect(() => Buffer.from(iv, 'base64')).not.toThrow();
      expect(() => Buffer.from(tag, 'base64')).not.toThrow();
      expect(() => Buffer.from(ciphertextPart, 'base64')).not.toThrow();

      // Verify IV and tag lengths
      const ivBuffer = Buffer.from(iv, 'base64');
      const tagBuffer = Buffer.from(tag, 'base64');
      expect(ivBuffer.length).toBe(12); // IV is 12 bytes for GCM
      expect(tagBuffer.length).toBe(16); // Auth tag is 16 bytes
    });

    it('should produce different ciphertext for same plaintext (due to random IV)', async () => {
      // Arrange: Create two users with the same SSN
      const ssn = '888-99-0000';

      const input1: CreateUserInput = {
        email: 'same-ssn-1@example.com',
        firstName: 'Same',
        lastName: 'SSN1',
        sensitive: { ssn },
      };

      const input2: CreateUserInput = {
        email: 'same-ssn-2@example.com',
        firstName: 'Same',
        lastName: 'SSN2',
        sensitive: { ssn },
      };

      // Act: Create both users
      const user1 = await UserModel.create(input1);
      const user2 = await UserModel.create(input2);
      createdUserIds.push(user1.id, user2.id);

      // Assert: Ciphertexts are different (due to random IV) even though plaintext is the same
      expect(user1.ssn_encrypted).not.toBe(user2.ssn_encrypted);

      // But both should decrypt to the same value
      const decrypted1 = await UserModel.decryptSensitiveFields(user1);
      const decrypted2 = await UserModel.decryptSensitiveFields(user2);
      expect(decrypted1.ssn).toBe(ssn);
      expect(decrypted2.ssn).toBe(ssn);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle missing encryption key gracefully', async () => {
      // Arrange: Set up a resolver that returns missing key
      EncryptionUtil.setKeyResolver(async () => ({
        currentVersion: 'v2',
        keys: {
          v1: 'test-key',
          // v2 is missing!
        },
      }));
      EncryptionUtil.clearCache();

      // Act & Assert: Should throw when trying to encrypt with missing current key
      const input: CreateUserInput = {
        email: 'missing-key@example.com',
        firstName: 'Missing',
        lastName: 'Key',
        sensitive: { ssn: '000-00-0000' },
      };

      await expect(UserModel.create(input)).rejects.toThrow(
        'No decryption key available for version'
      );

      // Restore test encryption
      await setupTestEncryption();
    });

    it('should safely handle decryption of null fields', async () => {
      // Arrange: Create a user with no sensitive fields
      const input: CreateUserInput = {
        email: 'null-fields@example.com',
        firstName: 'Null',
        lastName: 'Fields',
      };

      // Act: Create and fetch
      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      const fetchedUser = await UserModel.findById(createdUser.id);
      const decrypted = await UserModel.decryptSensitiveFields(fetchedUser!);

      // Assert: All fields are null
      expect(decrypted.ssn).toBeNull();
      expect(decrypted.passportNumber).toBeNull();
      expect(decrypted.governmentIdNumber).toBeNull();
      expect(decrypted.bankAccountDetails).toBeNull();
      expect(decrypted.paymentMethodDetails).toBeNull();
      expect(decrypted.phoneNumber).toBeNull();
      expect(decrypted.dateOfBirth).toBeNull();
    });

    it('should detect tampering with ciphertext (auth tag mismatch)', async () => {
      // Arrange: Create a user
      const input: CreateUserInput = {
        email: 'tampering-test@example.com',
        firstName: 'Tamper',
        lastName: 'Test',
        sensitive: { ssn: '333-44-5555' },
      };

      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      // Act: Manually corrupt the ciphertext in the database
      const ciphertext = createdUser.ssn_encrypted!;
      const parts = ciphertext.split(':');
      const [version, iv, tag, ciphertextPart] = parts;

      // Flip a bit in the ciphertext
      const corruptedBuffer = Buffer.from(ciphertextPart, 'base64');
      corruptedBuffer[0] ^= 0xFF; // Flip all bits in first byte
      const corruptedCiphertext = `${version}:${iv}:${tag}:${corruptedBuffer.toString('base64')}`;

      // Update the DB directly with corrupted ciphertext
      await pool.query(
        'UPDATE users SET ssn_encrypted = $1 WHERE id = $2',
        [corruptedCiphertext, createdUser.id]
      );

      // Act: Fetch and try to decrypt corrupted ciphertext
      const fetchedUser = await UserModel.findById(createdUser.id);
      const decrypted = await UserModel.decryptSensitiveFields(fetchedUser!);

      // Assert: Decryption fails gracefully and returns null (via safeDecrypt)
      expect(decrypted.ssn).toBeNull();
    });
  });

  describe('Re-encryption workflow', () => {
    it('should re-encrypt all sensitive fields for a user', async () => {
      // Arrange: Create a user
      const input: CreateUserInput = {
        email: 'reencrypt-test@example.com',
        firstName: 'Reencrypt',
        lastName: 'Test',
        sensitive: {
          ssn: '444-55-6666',
          phoneNumber: '+1555666777',
        },
      };

      const createdUser = await UserModel.create(input);
      createdUserIds.push(createdUser.id);

      const originalCiphertext = createdUser.ssn_encrypted!;

      // Act: Re-encrypt the user
      const success = await UserModel.reEncryptUser(createdUser.id);
      expect(success).toBe(true);

      // Fetch the re-encrypted user
      const reencryptedUser = await UserModel.findById(createdUser.id);

      // Assert: Ciphertext changed (new IV was generated)
      expect(reencryptedUser!.ssn_encrypted).not.toBe(originalCiphertext);

      // But plaintext is still correct
      const decrypted = await UserModel.decryptSensitiveFields(reencryptedUser!);
      expect(decrypted.ssn).toBe(input.sensitive!.ssn);
      expect(decrypted.phoneNumber).toBe(input.sensitive!.phoneNumber);
    });
  });
});
