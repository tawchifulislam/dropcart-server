import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { stripeWebhook } from './controllers/webhook.controller';
import { errorHandler, notFound } from './middleware/error';
import routes from './routes';
import mongoose from 'mongoose';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    stripeWebhook,
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.get('/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({ ok: connected });
  });

  app.use(routes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
