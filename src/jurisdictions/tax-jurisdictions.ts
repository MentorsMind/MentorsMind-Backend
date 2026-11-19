/**
 * Jurisdiction-aware tax rules configuration for MentorMinds.
 *
 * Each jurisdiction declares how tax liability should be calculated and which
 * export format its accounting software / tax authorities expect:
 *  - US  → 1099-K-compatible CSV
 *  - EU  → VAT summary (OSS / reverse-charge aware)
 *  - UK  → Making Tax Digital (MTD) machine-readable XML
 *
 * Rules are fully configurable so new countries can be added without changing
 * calculation code.
 */

export type TaxJurisdiction = "US" | "EU" | "UK";
export type TaxExportFormat = "1099K_CSV" | "VAT_SUMMARY" | "MTD_XML";

export interface JurisdictionRule {
  code: TaxJurisdiction;
  /** ISO 3166-1 alpha-2 country codes that map to this jurisdiction */
  countries: string[];
  exportFormat: TaxExportFormat;
  /** Default VAT/GST rate to apply when a country-specific override is absent */
  defaultTaxRate: number;
  /** Per-country tax rate overrides (ISO code → rate as a decimal, e.g. 0.2 = 20%) */
  countryRates: Record<string, number>;
  /** US: gross receipts threshold above which a 1099-K must be filed */
  form1099KThreshold: number;
  /** Header row for the exported file */
  sheetTitle: string;
}

const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
  "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT",
  "RO", "SK", "SI", "ES", "SE",
];

const EU_COUNTRY_RATES: Record<string, number> = {
  AT: 0.2, BE: 0.21, BG: 0.2, HR: 0.25, CY: 0.19, CZ: 0.21, DK: 0.25,
  EE: 0.2, FI: 0.24, FR: 0.2, DE: 0.19, GR: 0.24, HU: 0.27, IE: 0.23,
  IT: 0.22, LV: 0.21, LT: 0.21, LU: 0.17, MT: 0.18, NL: 0.21, PL: 0.23,
  PT: 0.23, RO: 0.19, SK: 0.2, SI: 0.22, ES: 0.21, SE: 0.25,
};

/**
 * Default rules per jurisdiction. Extend `JURISDICTION_RULES` to add more
 * countries or adjust thresholds/rates without touching calculation logic.
 */
export const JURISDICTION_RULES: Record<TaxJurisdiction, JurisdictionRule> = {
  US: {
    code: "US",
    countries: ["US", "VI", "GU", "AS", "MP", "PR", ""],
    exportFormat: "1099K_CSV",
    defaultTaxRate: 0,
    countryRates: {},
    // Form 1099-K applies at/above $600 in annual gross receipts (multiple states
    // use lower thresholds; the current single federal threshold is captured here).
    form1099KThreshold: 600,
    sheetTitle: "Furnished Payment Information (1099-K)",
  },
  EU: {
    code: "EU",
    countries: EU_COUNTRIES,
    exportFormat: "VAT_SUMMARY",
    defaultTaxRate: 0.2,
    countryRates: EU_COUNTRY_RATES,
    form1099KThreshold: 0,
    sheetTitle: "VAT Summary (EU)",
  },
  UK: {
    code: "UK",
    countries: ["GB"],
    exportFormat: "MTD_XML",
    defaultTaxRate: 0.2,
    countryRates: { GB: 0.2 },
    form1099KThreshold: 0,
    sheetTitle: "UK Making Tax Digital (MTD)",
  },
};

/**
 * Resolve the jurisdiction for a given ISO country code, falling back to US.
 */
export function resolveJurisdiction(countryCode?: string | null): TaxJurisdiction {
  const code = (countryCode || "").toUpperCase();
  for (const rule of Object.values(JURISDICTION_RULES)) {
    if (rule.countries.includes(code)) return rule.code;
  }
  return "US";
}

/**
 * Get the applicable tax rate for a country code under its jurisdiction.
 */
export function getTaxRate(countryCode?: string | null): number {
  const code = (countryCode || "").toUpperCase();
  const jurisdiction = resolveJurisdiction(code);
  const rule = JURISDICTION_RULES[jurisdiction];
  if (rule.countryRates[code] !== undefined) {
    return rule.countryRates[code];
  }
  return rule.defaultTaxRate;
}

/**
 * Determine the export format for a country code.
 */
export function getExportFormat(countryCode?: string | null): TaxExportFormat {
  return JURISDICTION_RULES[resolveJurisdiction(countryCode)].exportFormat;
}
