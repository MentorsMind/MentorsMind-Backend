/**
 * PII masking utilities for log output.
 *
 * Rules:
 *  - Email          → [REDACTED]@domain.tld
 *  - Phone          → ****-****-XXXX  (last 4 digits)
 *  - Credit card    → ****-****-****-XXXX (last 4 digits)
 *  - API key        → XXXX************************  (first 4 chars)
 *  - Stellar pubkey → XXXX…XXXX (first 4 + last 4 chars)
 */

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Standard email — local part is masked, domain is kept */
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/g;

/** Phone numbers: 10–15 digits, optional +, spaces, dashes, dots, parens */
const PHONE_RE =
  /(?<!\d)(\+?[\d\s\-().]{7,}?\d{4})(?!\d)/g;

/** Credit card: 13–19 digits, optionally separated by spaces or dashes */
const CREDIT_CARD_RE =
  /\b(?:\d[ \-]?){12,18}\d\b/g;

/**
 * API key heuristic: 20+ char alphanumeric/symbol strings that look like
 * secrets (not a URL path, not a UUID, not a Stellar key handled separately).
 * Matches common patterns: sk_live_..., pk_test_..., Bearer tokens, etc.
 */
const API_KEY_RE =
  /\b(?:sk|pk|api|key|token|bearer|secret)[_\-]?[A-Za-z0-9_\-]{16,}\b/gi;

/**
 * Stellar public key: starts with G, 56 base32 chars total.
 */
const STELLAR_PUBKEY_RE = /\bG[A-Z2-7]{55}\b/g;

// ---------------------------------------------------------------------------
// Individual maskers
// ---------------------------------------------------------------------------

export function maskEmail(value: string): string {
  return value.replace(EMAIL_RE, (_match, domain) => `[REDACTED]@${domain}`);
}

export function maskPhone(value: string): string {
  return value.replace(PHONE_RE, (match) => {
    const digits = match.replace(/\D/g, "");
    const last4 = digits.slice(-4);
    return `****-****-${last4}`;
  });
}

export function maskCreditCard(value: string): string {
  return value.replace(CREDIT_CARD_RE, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13) return match; // not a card number
    const last4 = digits.slice(-4);
    return `****-****-****-${last4}`;
  });
}

export function maskApiKey(value: string): string {
  return value.replace(API_KEY_RE, (match) => {
    const first4 = match.slice(0, 4);
    return `${first4}${"*".repeat(Math.max(0, match.length - 4))}`;
  });
}

export function maskStellarKey(value: string): string {
  return value.replace(STELLAR_PUBKEY_RE, (match) => {
    return `${match.slice(0, 4)}…${match.slice(-4)}`;
  });
}

// ---------------------------------------------------------------------------
// Combined masker — applies all rules to a string
// ---------------------------------------------------------------------------

export function maskPII(value: string): string {
  // Order matters: credit card before phone (cards are digit-heavy)
  let result = maskCreditCard(value);
  result = maskPhone(result);
  result = maskEmail(result);
  result = maskStellarKey(result);
  result = maskApiKey(result);
  return result;
}

// ---------------------------------------------------------------------------
// Deep-mask an arbitrary log object (walks strings recursively)
// ---------------------------------------------------------------------------

export function maskPIIDeep(value: unknown, depth = 0): unknown {
  if (depth > 10 || value === null || value === undefined) return value;

  if (typeof value === "string") return maskPII(value);

  if (Array.isArray(value))
    return value.map((item) => maskPIIDeep(item, depth + 1));

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = maskPIIDeep(v, depth + 1);
    }
    return result;
  }

  return value;
}
