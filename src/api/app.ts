import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config.ts';
import { errorHandler } from './middleware/error-handler.ts';
import { notFoundHandler } from './middleware/not-found.ts';
import { spaFallback } from './middleware/spa-fallback.ts';
import { apiRouter } from './routes/index.ts';

export const createApp = (): Express => {
  const app = express();

  app.disable('x-powered-by');

  // Security headers first, so every response (API, static assets, SPA, 404s, errors) carries them.
  // Helmet's default CSP fits the Vite build (no inline scripts). `upgrade-insecure-requests` is
  // dropped in development because Safari would otherwise upgrade http://localhost to https.
  // `nodeEnv` defaults to development when NODE_ENV is unset, so production deploys must set it.
  // If the UI starts loading a third-party origin, add it to the matching CSP directive here.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'upgrade-insecure-requests': config.nodeEnv === 'development' ? null : [],
        },
      },
    }),
  );

  app.use(express.json());

  // JSON API.
  app.use('/api', apiRouter);

  // Unknown /api/* paths must 404 as JSON rather than fall through to the SPA.
  app.use('/api', notFoundHandler);

  // Built React assets, then the SPA entry point for everything else.
  app.use(express.static(config.uiDir, { index: false }));
  app.use(spaFallback);

  // Nothing matched, e.g. a POST to an unknown path.
  app.use(notFoundHandler);

  // Last, so it catches errors thrown or rejected anywhere above.
  app.use(errorHandler);

  return app;
};
