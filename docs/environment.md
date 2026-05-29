# Environment Configuration Guide

## Overview

MentorsMind-Backend validates **all environment variables on startup** using [Zod](https://zod.dev). If a required variable is missing or has an invalid value, the server will **crash immediately** with a clear, human-readable error message — so you never run with a broken config.

---

## Quick Start for New Developers

```bash
# 1. Copy the example file
cp .env.example .env

# 2. Fill in the required values (see table below)
nano .env   # or open in your editor

# 3. (Optional) Create a personal override file — never committed
cp .env .env.local

# 4. Start the server
npm run dev
```

> **Tip:** `.env.local` overrides `.env` for developer machines. Put personal API keys or local DB credentials there — it's in `.gitignore`.

---

## Environment Files

| File | Purpose | Committed? |
|------|---------|-----------|
| `.env.example` | Template with all variables documented | ✅ Yes |
| `.env` | Your local values | ❌ No |
| `.env.local` | Personal overrides (takes precedence over `.env`) | ❌ No |
| `.env.test` | Safe dummy values for running tests | ✅ Yes |

---

## All Environment Variables

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Runtime mode: `development`, `test`, `production` |
| `PORT` | No | `5000` | HTTP server port |
| `API_VERSION` | No | `v1` | API prefix (e.g. `/api/v1`) |

### Database (PostgreSQL)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ Yes | — | Full PostgreSQL connection URL |
| `DB_HOST` | No | `localhost` | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_NAME` | No | `mentorminds` | Database name |
| `DB_USER` | No | `postgres` | Database user |
| `DB_PASSWORD` | ✅ Yes | — | Database password — **never log this** |

### JWT / Auth

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | ✅ Yes (≥32 chars) | — | Access token signing secret |
| `JWT_EXPIRES_IN` | No | `7d` | Access token expiry |
| `JWT_REFRESH_SECRET` | ✅ Yes (≥32 chars) | — | Refresh token signing secret |
| `JWT_REFRESH_EXPIRES_IN` | No | `30d` | Refresh token expiry |

> ⚠️ **Security:** Generate secrets with `openssl rand -base64 48`. Never commit real secrets.

### Stellar Network

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STELLAR_NETWORK` | No | `testnet` | `testnet` or `mainnet` |
| `STELLAR_HORIZON_URL` | ✅ Yes | — | Horizon API URL |
| `PLATFORM_PUBLIC_KEY` | No | — | Platform wallet public key |
| `PLATFORM_SECRET_KEY` | No | — | Platform wallet secret — **never log this** |

### CORS

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CORS_ORIGIN` | No | `http://localhost:3000,http://localhost:5173` | Comma-separated allowed origins |

### Rate Limiting

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rolling window in ms (default: 15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window per IP |

### Email (SMTP / Gmail)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | No | — | SMTP server host |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_SECURE` | No | `false` | Use TLS: `true` or `false` |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password — **never log this** |
| `GMAIL_USER` | No | — | Gmail account (fallback) |
| `GMAIL_PASS` | No | — | Gmail app password — **never log this** |
| `FROM_EMAIL` | No | `noreply@mentorminds.com` | Sender address for outgoing mail |

### Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | No | — | Redis connection URL (enables caching) |

### Logging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error` |
| `LOG_FILE_PATH` | No | `logs` | Directory for rotated log files (production) |
| `LOG_MAX_SIZE` | No | `20m` | Max size before log rotation |
| `LOG_MAX_FILES` | No | `14d` | Log file retention period |

### Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCRYPT_ROUNDS` | No | `10` | bcrypt cost factor (use `1` in tests for speed) |

### Platform

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PLATFORM_FEE_PERCENTAGE` | No | `5` | Transaction fee percentage |

### Meeting Provider

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEETING_PROVIDER` | No | `daily` | `daily`, `whereby`, `zoom`, or `jitsi` |
| `MEETING_API_KEY` | No | — | API key for the chosen provider |
| `MEETING_API_SECRET` | No | — | Additional secret (provider-dependent) |
| `MEETING_ROOM_EXPIRY_MINUTES` | No | `30` | Minutes before meeting room expires |
| `MEETING_RETRY_ATTEMPTS` | No | `1` | Retry attempts on provider API failure |
| `JITSI_BASE_URL` | No | `https://meet.jit.si` | Jitsi server URL (self-hosted only) |

---

## Startup Validation

`src/config/env.ts` runs on import and calls `process.exit(1)` with a formatted message if any variable fails:

```
❌ Invalid environment configuration:

  - DATABASE_URL: DATABASE_URL must be a valid URL
  - JWT_SECRET: JWT_SECRET must be at least 32 characters

Check your .env file against .env.example
```

---

## Secrets Management Rules

1. **Never log** `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SMTP_PASS`, `GMAIL_PASS`, `PLATFORM_SECRET_KEY`, or `MEETING_API_SECRET`
2. **Never commit** `.env` or `.env.local`
3. Use **`.env.local`** for personal overrides on developer machines
4. In production, inject secrets via your CI/CD secrets manager (GitHub Actions secrets, AWS Secrets Manager, etc.)
5. JWT secrets must be **at least 32 characters** — generate with: `openssl rand -base64 48`

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `DATABASE_URL must be a valid URL` | Missing or malformed URL | Set `DATABASE_URL=postgresql://user:pass@host:5432/db` |
| `JWT_SECRET must be at least 32 characters` | Secret too short | Generate: `openssl rand -base64 48` |
| `Invalid enum value` for `NODE_ENV` | Typo in value | Must be exactly `development`, `test`, or `production` |
| `connect ECONNREFUSED` at runtime | DB not running | `brew services start postgresql` |
| Tests fail with env errors | `.env.test` missing a variable | Add it to `.env.test` with a safe dummy value |
