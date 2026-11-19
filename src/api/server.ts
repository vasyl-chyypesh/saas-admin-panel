import { createApp } from './app.ts';
import { config } from './config.ts';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

const shutdown = (signal: NodeJS.Signals): void => {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
