import {
  TaxExportFormat,
  JURISDICTION_RULES,
  getTaxRate,
} from "../jurisdictions/tax-jurisdictions";

/**
 * Escapes a value for safe inclusion in a CSV cell (RFC 4180): wraps in quotes
 * and doubles embedded quotes.
 */
function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Builds a CSV rows string from a header + array of tuples. */
function buildCsv(header: string[], rows: Array<Array<unknown>>): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Escapes text for XML element content (MTD requires well-formed XML). */
function xmlEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toTwoDecimals(value: number): string {
  return value.toFixed(2);
}

export interface TaxExportInput {
  mentorId: string;
  mentorName?: string | null;
  countryCode?: string | null;
  taxYear: number;
  totalEarnings: number;
  platformFees: number;
  netEarnings: number;
  withholdingAmount: number;
}

export interface TaxExportResult {
  format: TaxExportFormat;
  fileName: string;
  data: string;
  mimeType: string;
}

/**
 * Generates the jurisdiction-appropriate structured export for a tax report:
 *   US → 1099-K-compatible CSV
 *   EU → VAT summary (per-country rates)
 *   UK → Making Tax Digital (MTD) machine-readable XML
 */
export function generateTaxExport(
  input: TaxExportInput,
  format?: TaxExportFormat,
): TaxExportResult {
  const resolvedFormat: TaxExportFormat =
    format ?? inferFormat(input.countryCode);

  switch (resolvedFormat) {
    case "1099K_CSV":
      return generate1099KCsv(input);
    case "VAT_SUMMARY":
      return generateVatSummary(input);
    case "MTD_XML":
      return generateMtdXml(input);
  }
}

function inferFormat(countryCode?: string | null): TaxExportFormat {
  const rule = Object.values(JURISDICTION_RULES).find((r) =>
    r.countries.includes((countryCode || "").toUpperCase()),
  );
  return rule ? rule.exportFormat : "1099K_CSV";
}

function generate1099KCsv(input: TaxExportInput): TaxExportResult {
  const header = [
    "Tax Year",
    "Mentor ID",
    "Mentor Name",
    "Total Gross Receipts",
    "Platform Fees",
    "Net Earnings",
    "Withholding",
    "Country",
  ];
  const rows = [
    [
      input.taxYear,
      input.mentorId,
      input.mentorName ?? "",
      toTwoDecimals(input.totalEarnings),
      toTwoDecimals(input.platformFees),
      toTwoDecimals(input.netEarnings),
      toTwoDecimals(input.withholdingAmount),
      (input.countryCode ?? "").toUpperCase(),
    ],
  ];

  return {
    format: "1099K_CSV",
    fileName: `1099K-${input.taxYear}-${input.mentorId}.csv`,
    data: buildCsv(header, rows),
    mimeType: "text/csv",
  };
}

function generateVatSummary(input: TaxExportInput): TaxExportResult {
  const rate = getTaxRate(input.countryCode);
  const taxable = input.netEarnings;
  const vatAmount = taxable * rate;

  // VAT summary with the per-country rate applied.
  const header = [
    "Tax Year",
    "Country",
    "VAT Rate",
    "Net Amount",
    "VAT Amount",
    "Gross Amount",
  ];
  const rows = [
    [
      input.taxYear,
      (input.countryCode ?? "").toUpperCase(),
      `${(rate * 100).toFixed(1)}%`,
      toTwoDecimals(taxable),
      toTwoDecimals(vatAmount),
      toTwoDecimals(taxable + vatAmount),
    ],
  ];

  return {
    format: "VAT_SUMMARY",
    fileName: `VAT-SUMMARY-${input.taxYear}-${input.mentorId}.csv`,
    data: buildCsv(header, rows),
    mimeType: "text/csv",
  };
}

function generateMtdXml(input: TaxExportInput): TaxExportResult {
  const rate = getTaxRate(input.countryCode);
  const vatAmount = input.netEarnings * rate;

  // HMRC-style MTD VAT return fragment (Ubl:Request / VatReturn envelope).
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VatReturn
    xmlns="urn:hmrc:vat:return"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <PeriodKey>${input.taxYear}</PeriodKey>
  <Vrn>${xmlEscape(input.mentorId)}</Vrn>
  <Declaration>
    <Box1>${toTwoDecimals(vatAmount)}</Box1>
    <Box5>${toTwoDecimals(vatAmount)}</Box5>
    <Box6>${toTwoDecimals(input.netEarnings)}</Box6>
    <Box7>${toTwoDecimals(input.platformFees)}</Box7>
    <Box8>${toTwoDecimals(input.totalEarnings)}</Box8>
  </Declaration>
  <TraineeDetails>
    <Name>${xmlEscape(input.mentorName ?? "")}</Name>
    <Country>${xmlEscape((input.countryCode ?? "").toUpperCase())}</Country>
    <TaxRate>${(rate * 100).toFixed(1)}</TaxRate>
    <NetAmount>${toTwoDecimals(input.netEarnings)}</NetAmount>
    <VatAmount>${toTwoDecimals(vatAmount)}</VatAmount>
  </TraineeDetails>
</VatReturn>
`;

  return {
    format: "MTD_XML",
    fileName: `MTD-${input.taxYear}-${input.mentorId}.xml`,
    data: xml,
    mimeType: "application/xml",
  };
}
