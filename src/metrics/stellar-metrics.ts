import { Counter, Gauge, Histogram } from "prom-client";
import { metricsRegistry } from "../config/metrics";

export const stellarStreamCursorGauge = new Gauge<string>({
  name: "stellar_stream_cursor_last_seen",
  help: "Most recent persisted Horizon stream cursor per account",
  labelNames: ["account"],
  registers: [metricsRegistry],
});

export const stellarStreamReconnectsTotal = new Counter<string>({
  name: "stellar_stream_reconnects_total",
  help: "Total Stellar Horizon stream reconnects after disconnects",
  labelNames: ["account", "outcome"],
  registers: [metricsRegistry],
});

export const stellarStreamDisconnectsTotal = new Counter<string>({
  name: "stellar_stream_disconnects_total",
  help: "Total Stellar Horizon stream disconnect events",
  labelNames: ["account"],
  registers: [metricsRegistry],
});

export const stellarStreamFallbackPollingTotal = new Counter<string>({
  name: "stellar_stream_fallback_polling_total",
  help: "Total times the Stellar stream falls back to polling after reconnect exhaustion",
  labelNames: ["account"],
  registers: [metricsRegistry],
});

export const stellarStreamReconnectDelaySeconds = new Histogram<string>({
  name: "stellar_stream_reconnect_delay_seconds",
  help: "Backoff delay before attempting Stellar stream reconnection",
  labelNames: ["account"],
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});
