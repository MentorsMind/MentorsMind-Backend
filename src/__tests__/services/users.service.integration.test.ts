/**
 * UsersService Integration Tests
 *
 * Tests the SQL parameter placeholder fix - ensures $N syntax is used correctly
 * when building dynamic UPDATE queries.
 */
import { UsersService, UpdateUserPayload } from "../../services/users.service";
import { createUser } from "../factories/user.factory";
import { testPool } from "../setup/testDb";

describe("UsersService Integration", () => {
  describe("update", () => {
    it("should update user with single field populated", async () => {
      const user = await createUser({
        firstName: "Original",
        lastName: "Name",
      });

      const payload: UpdateUserPayload = {
        firstName: "Updated",
      };

      const result = await UsersService.update(user.id, payload);

      expect(result).not.toBeNull();
      expect(result!.first_name).toBe("Updated");
      expect(result!.last_name).toBe("Name"); // unchanged
    });

    it("should update user with all fields populated", async () => {
      const user = await createUser({
        firstName: "Original",
        lastName: "Name",
        bio: "Original bio",
      });

      const payload: UpdateUserPayload = {
        firstName: "Jane",
        lastName: "Smith",
        bio: "Software engineer with 10 years experience",
        notificationPreferences: {
          email: { marketing: true, security: true },
          push: { marketing: false, security: true },
        },
        phoneNumber: "+1234567890",
        dateOfBirth: "1990-01-15",
        governmentIdNumber: "ID123456",
        bankAccountDetails: "Bank Account 987654321",
      };

      const result = await UsersService.update(user.id, payload);

      expect(result).not.toBeNull();
      expect(result!.first_name).toBe("Jane");
      expect(result!.last_name).toBe("Smith");
      expect(result!.bio).toBe("Software engineer with 10 years experience");
      expect(result!.notification_preferences).toEqual({
        email: { marketing: true, security: true },
        push: { marketing: false, security: true },
      });
      expect(result!.phone_number).toBe("+1234567890");
      expect(result!.date_of_birth).toBe("1990-01-15");
      expect(result!.government_id_number).toBe("ID123456");
      expect(result!.bank_account_details).toBe("Bank Account 987654321");
      expect(result!.pii_encryption_version).toBeDefined();
    });

    it("should update user with multiple fields in different combinations", async () => {
      const user = await createUser({
        firstName: "Original",
        lastName: "Name",
        bio: "Original bio",
      });

      // Test combination 1: bio + notificationPreferences
      let result = await UsersService.update(user.id, {
        bio: "Updated bio",
        notificationPreferences: { email: { marketing: false } },
      });
      expect(result!.bio).toBe("Updated bio");
      expect(result!.notification_preferences).toEqual({
        email: { marketing: false },
      });

      // Test combination 2: firstName + phoneNumber
      result = await UsersService.update(user.id, {
        firstName: "Alice",
        phoneNumber: "+9876543210",
      });
      expect(result!.first_name).toBe("Alice");
      expect(result!.phone_number).toBe("+9876543210");

      // Test combination 3: dateOfBirth + governmentIdNumber + bankAccountDetails
      result = await UsersService.update(user.id, {
        dateOfBirth: "1985-06-20",
        governmentIdNumber: "NEW-ID-789",
        bankAccountDetails: "New Bank 123456789",
      });
      expect(result!.date_of_birth).toBe("1985-06-20");
      expect(result!.government_id_number).toBe("NEW-ID-789");
      expect(result!.bank_account_details).toBe("New Bank 123456789");
    });

    it("should handle empty payload by returning current user without update", async () => {
      const user = await createUser({
        firstName: "John",
        lastName: "Doe",
      });

      const result = await UsersService.update(user.id, {});

      expect(result).not.toBeNull();
      expect(result!.first_name).toBe("John");
      expect(result!.last_name).toBe("Doe");
    });

    it("should return null when updating non-existent user", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";

      const result = await UsersService.update(fakeId, {
        firstName: "Test",
      });

      expect(result).toBeNull();
    });

    it("should not update inactive users", async () => {
      const user = await createUser({
        firstName: "Inactive",
        isActive: false,
      });

      const result = await UsersService.update(user.id, {
        firstName: "ShouldNotUpdate",
      });

      expect(result).toBeNull();
    });

    it("should correctly build SQL with proper $N parameter placeholders", async () => {
      // This test verifies the bug fix - ensuring the SQL is built with $N syntax
      // not bare numbers like "first_name = 1"
      const user = await createUser();

      const payload: UpdateUserPayload = {
        firstName: "Test1",
        lastName: "Test2",
        bio: "Test3",
      };

      // Spy on pool.query to capture the generated SQL
      const querySpy = jest.spyOn(testPool, "query");

      await UsersService.update(user.id, payload);

      const calls = querySpy.mock.calls;
      const sqlCall = calls.find((call: [string, ...unknown[]]) =>
        call[0].toString().includes("UPDATE users SET"),
      );

      expect(sqlCall).toBeDefined();
      const sql = sqlCall![0].toString();

      // Verify the SQL contains proper PostgreSQL parameter placeholders ($1, $2, etc.)
      // NOT bare numbers like "first_name = 1"
      expect(sql).toContain("first_name = $1");
      expect(sql).toContain("last_name = $2");
      expect(sql).toContain("bio = $3");
      expect(sql).toContain("WHERE id = $4");

      // Ensure there's NO occurrence of "= 1" without the $
      expect(sql).not.toMatch(/= 1[^0-9]/); // should not have "= 1" followed by non-digit
      expect(sql).not.toMatch(/= 2[^0-9]/);
      expect(sql).not.toMatch(/= 3[^0-9]/);

      querySpy.mockRestore();
    });
  });
});
