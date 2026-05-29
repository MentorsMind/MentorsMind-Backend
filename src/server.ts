import http from 'http';
// Config must be imported first — validates env vars before anything else loads
import config from './config';
import app from './app';
import { initializeModels } from './models';
import { initializeCollaborationSocket } from './services/collaboration.socket';

// Initialize database tables
initializeModels().catch(err => {
  console.error('Failed to initialize models:', err);
});

const { port: PORT, apiVersion: API_VERSION } = config.server;
const NODE_ENV = config.env;

const server = http.createServer(app);
initializeCollaborationSocket(server);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${NODE_ENV}`);
  console.log(`🌐 API URL: http://localhost:${PORT}/api/${API_VERSION}`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`📚 API Docs: http://localhost:${PORT}/api/${API_VERSION}/docs`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

export default app;
