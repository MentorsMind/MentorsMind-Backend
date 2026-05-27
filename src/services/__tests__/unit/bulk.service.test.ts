import {
  parseUsersCsv,
  mapCsvRowsToUsers,
  validateUserImportRows,
  validatePaymentRows,
} from "../../bulk.service";

describe("BulkService validation", () => {
  it("parses CSV header and rows", () => {
    const csv = "email,firstName,lastName,role\na@test.com,Ann,Bee,mentee\n";
    const { header, rows } = parseUsersCsv(csv);
    const mapped = mapCsvRowsToUsers(header, rows);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].email).toBe("a@test.com");
  });

  it("rejects invalid user rows before processing", () => {
    const validation = validateUserImportRows([
      {
        email: "not-an-email",
        firstName: "A",
        lastName: "B",
        role: "mentee",
      },
    ]);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toHaveLength(1);
  });

  it("rejects invalid payment rows before processing", () => {
    const validation = validatePaymentRows([
      {
        userId: "bad",
        bookingId: "also-bad",
        amount: "-1",
      },
    ]);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });
});
