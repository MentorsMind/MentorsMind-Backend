// Config must be imported first — validates env vars before anything else loads
import config from './config';
import app from './app';
import { initializeModels } from './models';
import { initWebSocketServer } from './websocket/ws-server';
import { QueryMonitor } from './utils/query-monitor.utils';
import pool from './config/database';
import {
  emailWorker,
  paymentWorker,
  escrowReleaseWorker,
  reportWorker,
  startScheduler,
  stopScheduler,
} from './workers';
import { initializeEmailTemplates } from './services/template-initializer.service';

// Initialize database tables, then seed email templates
initializeModels()
  .then(() => initializeEmailTemplates())
  .catch((err) => {
    console.error('Failed to initialize models:', err);
  });

// Start background job workers and scheduler
startScheduler().catch((err) => {
  logger.error('Failed to start job scheduler', { error: err });
});

const { port: PORT, apiVersion: API_VERSION } = config.server;
const NODE_ENV = config.env;

// Start server
const server = app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    env: NODE_ENV,
    apiUrl: `http://localhost:${PORT}/api/${API_VERSION}`,
    healthCheck: `http://localhost:${PORT}/health`,
    apiDocs: `http://localhost:${PORT}/api/${API_VERSION}/docs`,
    webSocket: `ws://localhost:${PORT}/ws`,
  });
});

// Attach Socket.IO server to the same HTTP server
const io = createSocketServer(server);
initializeSocketService(io);

// Subscribe to Stellar Horizon SSE for real-time payment confirmations
startStellarStream();

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`${signal} signal received: closing HTTP server`);
  stopStellarStream();
  await Promise.all([
    emailWorker.close(),
    paymentWorker.close(),
    escrowReleaseWorker.close(),
    reportWorker.close(),
    stopScheduler(),
  ]);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
