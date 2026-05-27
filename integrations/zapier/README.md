# MentorMinds Zapier App

This directory contains a Zapier app scaffold for MentorMinds to enable no-code automations.

Quick start

- Install Zapier CLI:

```bash
npm install -g zapier-platform-cli
```

- From this folder, install dependencies:

```bash
cd integrations/zapier
npm install
```

- Run tests / local checks (requires `zapier` CLI):

```bash
zapier test
```

Local auth & testing

- In Zapier developer UI you can connect using:
  - `api_key`: your MentorMinds API token (Bearer)
  - `base_url`: API base (defaults to `http://localhost:3000`)

- Use `zapier test` and `zapier push` to iterate; refer to Zapier docs to register and publish your app.

Publishing

- Use Zapier CLI to push a new version to your developer account:

```bash
zapier login
zapier push
```

- After pushing, follow Zapier Developer Platform to submit for review and publish to the Zapier App Directory.

Notes

- The app uses simple API Key (Bearer) authentication. If MentorMinds uses OAuth2, replace the `authentication.js` with OAuth flow.
- Endpoints used (assumes existing API):
  - `GET /v1/bookings?since=...`
  - `GET /v1/transactions?since=...&status=completed`
  - `GET /v1/disputes?since=...&status=open`
  - `POST /v1/users`
  - `POST /v1/notifications/email`
  - `PATCH /v1/transactions/:id`
