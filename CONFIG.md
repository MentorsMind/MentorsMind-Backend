# Configuration Reference

All configuration is validated with **Zod** on startup. The server will exit with a clear error message if any required variable is missing or invalid.

Sensitive variables (marked 🔒) are **never** logged or included in error output.

---

## Environment Files

| File | Purpose |
|------|---------|
| `.env` | Base values (committed as `.env.example`, never commit real secrets) |
| `.env.development` | Development defaults — loaded when `NODE_ENV=development` |
| `.env.test` | Test defaults — loaded when `NODE_ENV=test` |
| `.env.staging` | Staging template — secrets injected by provider |
| `.env.local` | Local machine overrides — never committed, highest priority |

Load order (later files override earlier ones):
`.env` → `.env.{NODE_ENV}` → `.env.local`

---

## Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | `development` \| `test` \| `staging` \| `production` |
| `PORT` | No | `5000` | HTTP server port |
| `API_VERSION` | No | `v1` | API path prefix (e.g. `/api/v1`) |

---

## Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | Full PostgreSQL connection string |
| `DB_HOST` | No | `localhost` | Database host |
| `DB_PORT` | No | `5432` | Database port |
| `DB_NAME` | No | `mentorminds` | Database name |
| `DB_USER` | No | `postgres` | Database user |
| `DB_PASSWORD` 🔒 | **Yes** | — | Database password |

---

## JWT Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` 🔒 | **Yes** | — | Signing secret — minimum 32 characters |
| `JWT_EXPIRES_IN` | No | `7d` | Access token TTL |
| `JWT_REFRESH_SECRET` 🔒 | **Yes** | — | Refresh token signing secret — minimum 32 characters |
| `JWT_REFRESH_EXPIRES_IN` | No | `30d` | Refresh token TTL |
| `JWT_SECRET_PREVIOUS` 🔒 | No | — | Previous signing secret — accepted during key rotation window |

### Zero-Downtime JWT Rotation

1. Generate a new secret
2. Set `JWT_SECRET_PREVIOUS` = current `JWT_SECRET`
3. Set `JWT_SECRET` = new secret
4. Deploy — both secrets are accepted
5. After all old tokens expire, remove `JWT_SECRET_PREVIOUS`

---

## Stellar Network

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STELLAR_NETWORK` | No | `testnet` | `testnet` \| `mainnet` |
| `STELLAR_HORIZON_URL` | **Yes** | — | Horizon server URL |
| `PLATFORM_PUBLIC_KEY` | No | — | Platform wallet public key |
| `PLATFORM_SECRET_KEY` 🔒 | No | — | Platform wallet secret key |

---

## CORS

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CORS_ORIGIN` | No | `http://localhost:3000,http://localhost:5173` | Comma-separated allowed origins |

---

## Rate Limiting

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Window size in ms (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window per IP |

---

## Email (SMTP)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | No | — | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_SECURE` | No | `false` | Use TLS (`true` \| `false`) |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` 🔒 | No | — | SMTP password |
| `GMAIL_USER` | No | — | Gmail address (alternative to SMTP) |
| `GMAIL_PASS` 🔒 | No | — | Gmail app password |
| `FROM_EMAIL` | No | `noreply@mentorminds.com` | Sender address |

---

## Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | No | — | Redis connection URL (used for caching and queues) |

---

## Firebase (Push Notifications)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIREBASE_PROJECT_ID` | No | — | Firebase project ID |
| `FIREBASE_PRIVATE_KEY` 🔒 | No | — | Firebase service account private key |
| `FIREBASE_CLIENT_EMAIL` | No | — | Firebase service account email |

---

## Logging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | `debug` \| `info` \| `warn` \| `error` |

---

## Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCRYPT_ROUNDS` | No | `10` | bcrypt cost factor for password hashing |
| `FILE_SIGNING_SECRET` 🔒 | **Yes** | — | HMAC signing key for file access tokens — minimum 32 characters, must be different from JWT_SECRET |

---

## Platform

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PLATFORM_FEE_PERCENTAGE` | No | `5` | Platform fee percentage per transaction |

---

## Secrets Management

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRETS_PROVIDER` | No | `env` | `env` \| `aws` \| `vault` |
| `AWS_REGION` | No | `us-east-1` | AWS region for Secrets Manager |
| `AWS_SECRET_ID` | If `SECRETS_PROVIDER=aws` | — | AWS Secrets Manager secret name/ARN |
| `VAULT_ADDR` | If `SECRETS_PROVIDER=vault` | — | HashiCorp Vault server URL |
| `VAULT_TOKEN` 🔒 | If `SECRETS_PROVIDER=vault` | — | Vault authentication token |
| `VAULT_SECRET_PATH` | If `SECRETS_PROVIDER=vault` | — | KV path (e.g. `secret/data/mentorminds/prod`) |

### AWS Secrets Manager

Store a JSON object in Secrets Manager with these keys:

```json
{
  "JWT_SECRET": "...",
  "JWT_REFRESH_SECRET": "...",
  "JWT_SECRET_PREVIOUS": "...",
  "FILE_SIGNING_SECRET": "...",
  "DB_PASSWORD": "...",
  "SMTP_PASS": "...",
  "PLATFORM_SECRET_KEY": "..."
}
```

Set `SECRETS_PROVIDER=aws` and `AWS_SECRET_ID=mentorminds/prod/app-secrets`.

### HashiCorp Vault (KV v2)

```bash
vault kv put secret/mentorminds/prod \
  JWT_SECRET=... \
  JWT_REFRESH_SECRET=... \
  FILE_SIGNING_SECRET=... \
  DB_PASSWORD=...
```

Set `SECRETS_PROVIDER=vault`, `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_SECRET_PATH=secret/data/mentorminds/prod`.

---

## Monitoring

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PROMETHEUS_ENABLED` | No | `false` | Enable Prometheus metrics endpoint |
| `PROMETHEUS_PORT` | No | `9090` | Metrics server port |
| `PROMETHEUS_ENDPOINT` | No | `/metrics` | Metrics path |
| `HEALTH_CHECK_INTERVAL` | No | `30000` | Health check interval in ms |
| `HEALTH_CHECK_TIMEOUT` | No | `5000` | Health check timeout in ms |

---

## Sentry

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_DSN` | No | — | Sentry DSN — leave blank to disable |

---

## Meeting Provider

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEETING_PROVIDER` | No | `jitsi` | `daily` \| `whereby` \| `zoom` \| `jitsi` |
| `MEETING_API_KEY` 🔒 | If not Jitsi | — | Provider API key |
| `MEETING_ROOM_EXPIRY_MINUTES` | No | `30` | Minutes after session end before room expires |

---

🔒 = sensitive — never logged, never included in error output, injected via secrets provider in production.
