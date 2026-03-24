# WebSocket API

The WebSocket server runs on the same port as the HTTP server at path `/ws`.

## Connection

```
ws://localhost:3000/ws?token=<access_jwt>
```

Or via the `Sec-WebSocket-Protocol` header:

```
Sec-WebSocket-Protocol: Bearer <access_jwt>
```

On success the server immediately sends:

```json
{ "event": "connected", "data": { "userId": "<id>" } }
```

On auth failure the connection is closed with code **4001**.

---

## Client → Server Events

| Event  | Payload | Description |
|--------|---------|-------------|
| `ping` | `{}` | Keepalive check |

### Ping

```json
{ "event": "ping" }
```

Response:

```json
{ "event": "pong", "data": { "ts": 1711234567890 } }
```

---

## Server → Client Events

### `booking:confirmed`
Sent to the **mentee** when a booking is confirmed.

```json
{
  "event": "booking:confirmed",
  "data": {
    "bookingId": "uuid",
    "scheduledAt": "2026-04-01T10:00:00Z",
    "topic": "TypeScript",
    "status": "confirmed"
  }
}
```

### `booking:new`
Sent to the **mentor** when a learner books a session.

```json
{
  "event": "booking:new",
  "data": {
    "bookingId": "uuid",
    "scheduledAt": "2026-04-01T10:00:00Z",
    "topic": "TypeScript",
    "menteeId": "uuid"
  }
}
```

### `booking:cancelled`
Sent to **both** parties when a booking is cancelled.

```json
{
  "event": "booking:cancelled",
  "data": { "bookingId": "uuid" }
}
```

### `session:status`
Sent to the relevant user when a session status changes.

```json
{
  "event": "session:status",
  "data": {
    "sessionId": "uuid",
    "status": "confirmed",
    "meetingUrl": "https://meet.example.com/room"
  }
}
```

### `payment:status`
Sent to the payer when a payment state changes.

```json
{
  "event": "payment:status",
  "data": {
    "transactionId": "uuid",
    "bookingId": "uuid",
    "status": "completed",
    "amount": "50.0000000",
    "currency": "XLM"
  }
}
```

Possible `status` values: `pending` | `completed` | `failed` | `refunded`

### `escrow:update`
Sent to **both** mentor and mentee on escrow state changes.

```json
{
  "event": "escrow:update",
  "data": {
    "escrowId": "uuid",
    "bookingId": "uuid",
    "status": "released",
    "amount": "50.0000000"
  }
}
```

---

## Heartbeat

The server pings all clients every **30 seconds**. Clients that do not respond within the next ping cycle are terminated. The `ws` library handles pong frames automatically in most clients.

---

## Reconnection (Client Guide)

Implement exponential backoff on the client side:

```js
let retryDelay = 1000;
const MAX_DELAY = 30_000;

function connect() {
  const ws = new WebSocket(`wss://api.example.com/ws?token=${getToken()}`);

  ws.onopen = () => { retryDelay = 1000; };

  ws.onclose = (e) => {
    if (e.code === 4001) return; // auth failure — don't retry
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
  };
}
```

---

## Scaling (Redis Pub/Sub)

When `REDIS_URL` is set, all published events go through the `mm:ws:events` Redis channel. This allows multiple server instances to deliver messages to the correct client regardless of which instance holds the connection.

If Redis is unavailable, delivery falls back to in-process routing (single-instance only).
