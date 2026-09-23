# Security Policy

## Supported Versions

The following versions of MentorMinds Stellar are currently supported with security updates:

| Version | Supported          |
|---------|--------------------|
| v2.x    | :white_check_mark: |
| v1.x    | :white_check_mark: |
| < v1.0  | :x:                |

## Reporting a Vulnerability

We take the security of MentorMinds Stellar seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Where to Report

**Do not open a public GitHub issue.** Instead, report via one of the following channels:

1. **Email**: [security@mentorminds.com](mailto:security@mentorminds.com) — Preferred for sensitive reports.
2. **GitHub Private Advisory**: Use the [Security Advisory](https://github.com/MentorsMind/MentorsMind-Backend/security/advisories/new) feature on this repository.

### What to Include

To help us triage and fix the issue quickly, please include:

- **Type of vulnerability** (e.g., SQL injection, XSS, broken authentication, privilege escalation)
- **Affected endpoints or components** (API route, module, or feature)
- **Steps to reproduce** — a minimal, complete, and reproducible test case
- **Expected vs. actual behavior**
- **Impact** — what an attacker could achieve (e.g., data exposure, denial of service, account takeover)
- **Environment details** — server version, deployment configuration, browser/OS if client-side
- **Proof of concept** (if available and safe to share)

### What NOT to Do

- **Do not publicly disclose** the vulnerability before we have had a reasonable opportunity to fix it.
- **Do not actively exploit** the vulnerability — no data exfiltration, destruction, or modification of production data.
- **Do not perform attacks** that could degrade service availability (e.g., DDoS, brute-force flooding).

### Response Timeline

We aim to acknowledge and respond to vulnerability reports as follows:

| Step               | Target Timeframe |
|--------------------|------------------|
| Initial response   | Within 48 hours  |
| Triage & severity assessment | Within 7 days |
| Fix development & review | Within 30 days (depending on severity) |
| Public disclosure  | After a fix is released and tested |

We will keep you informed of progress throughout the process.

## Compliance Context

MentorMinds Stellar operates in a regulated environment and maintains compliance with:

- **PCI DSS** — Payment card data handling follows PCI security standards. All payment processing routes apply encryption, tokenization, and access controls.
- **GDPR** — User data collection and processing complies with GDPR requirements, including data export, deletion, and consent management features.
- **SOC 2** — Audit logging, access controls, and monitoring controls align with SOC 2 trust services criteria.

Severity ratings for reported vulnerabilities will consider this compliance context — vulnerabilities affecting cardholder data, PII, or audit integrity will be treated as high or critical severity.

## Security Measures

This repository integrates security into every stage of the development lifecycle:

- **SAST**: CodeQL and Semgrep scans run on every pull request (see [`.github/workflows/security.yml`](.github/workflows/security.yml)).
- **Dependency scanning**: `pnpm audit` and GitHub Dependency Review block pull requests introducing high-severity vulnerabilities.
- **Secret scanning**: Gitleaks scans for hardcoded secrets.
- **DAST**: OWASP ZAP baseline scans run against the API on every push to `main`.
- **Security tests**: Dedicated OWASP Top 10 regression tests cover injection, access control, authentication, and SSRF.
- **Token security**: Short-lived JWTs with rotation, theft detection, and hardware-backed signing.

## Recognition

We are grateful to the security research community. Contributors who report valid vulnerabilities will be credited in our security acknowledgments (with their consent). At this time, we do not operate a formal bug bounty program.