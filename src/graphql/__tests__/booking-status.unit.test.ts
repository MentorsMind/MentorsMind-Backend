/**
 * Unit tests for GraphQL BookingStatus enum and Booking.status resolver.
 *
 * Tests verify that:
 *  1. The BookingStatus enum includes NO_SHOW and RESCHEDULED.
 *  2. The Booking.status resolver maps DB lowercase values to the correct
 *     uppercase GraphQL enum values (including no_show → NO_SHOW).
 *  3. All existing status values continue to map correctly.
 */

// ─── Imports ──────────────────────────────────────────────────────────────────

import resolvers from "../resolvers/index";
import typeDefs from "../schema";
import { DocumentNode, parse, buildASTSchema } from "graphql";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the enum values from the compiled schema for a given enum type. */
function getEnumValues(schema: ReturnType<typeof buildASTSchema>, typeName: string): string[] {
  const type = schema.getType(typeName);
  if (!type || !("getValues" in type)) {
    throw new Error(`${typeName} is not an enum type in the schema`);
  }
  return (type as any).getValues().map((v: any) => v.name);
}

/** Call the Booking.status resolver with a fake parent object. */
function resolveStatus(dbStatus: string): string {
  const bookingResolver = (resolvers as any).Booking;
  if (!bookingResolver?.status) {
    throw new Error("Booking.status resolver is not defined");
  }
  return bookingResolver.status({ status: dbStatus });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BookingStatus GraphQL enum", () => {
  let schema: ReturnType<typeof buildASTSchema>;

  beforeAll(() => {
    schema = buildASTSchema(typeDefs as DocumentNode);
  });

  it("includes NO_SHOW in the BookingStatus enum", () => {
    const values = getEnumValues(schema, "BookingStatus");
    expect(values).toContain("NO_SHOW");
  });

  it("includes RESCHEDULED in the BookingStatus enum", () => {
    const values = getEnumValues(schema, "BookingStatus");
    expect(values).toContain("RESCHEDULED");
  });

  it("retains all original BookingStatus values", () => {
    const values = getEnumValues(schema, "BookingStatus");
    expect(values).toEqual(
      expect.arrayContaining(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"]),
    );
  });
});

describe("Booking.status resolver — DB → GraphQL enum mapping", () => {
  it("maps no_show to NO_SHOW", () => {
    expect(resolveStatus("no_show")).toBe("NO_SHOW");
  });

  it("maps rescheduled to RESCHEDULED", () => {
    expect(resolveStatus("rescheduled")).toBe("RESCHEDULED");
  });

  it("maps pending to PENDING", () => {
    expect(resolveStatus("pending")).toBe("PENDING");
  });

  it("maps confirmed to CONFIRMED", () => {
    expect(resolveStatus("confirmed")).toBe("CONFIRMED");
  });

  it("maps completed to COMPLETED", () => {
    expect(resolveStatus("completed")).toBe("COMPLETED");
  });

  it("maps cancelled to CANCELLED", () => {
    expect(resolveStatus("cancelled")).toBe("CANCELLED");
  });

  it("handles uppercase DB values gracefully by uppercasing them", () => {
    // Defensive: if the DB ever returns uppercase, it should still work.
    expect(resolveStatus("NO_SHOW")).toBe("NO_SHOW");
  });
});
