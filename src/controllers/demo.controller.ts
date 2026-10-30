import { timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import { env } from '../config/env';
import { resetDemoData } from '../services/demo.service';
import { AppError } from '../utils/AppError';

const MIN_INTERVAL_MS = 60_000;
let lastReset = 0;

function ensureDemoMode() {
  if (!env.DEMO_MODE) throw new AppError(404, 'Route not found', 'NOT_FOUND');
}

function tokenMatches(provided: unknown) {
  if (typeof provided !== 'string' || !env.DEMO_RESET_TOKEN) return false;
  const given = Buffer.from(provided);
  const expected = Buffer.from(env.DEMO_RESET_TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function runReset(res: Response) {
  const now = Date.now();
  if (now - lastReset < MIN_INTERVAL_MS) {
    throw new AppError(
      429,
      'The demo was reset a moment ago. Please wait a minute.',
      'RESET_TOO_SOON',
    );
  }
  lastReset = now;
  try {
    res.json(await resetDemoData());
  } catch (error) {
    lastReset = 0;
    throw error;
  }
}

export async function scheduledReset(req: Request, res: Response) {
  ensureDemoMode();
  if (!tokenMatches(req.headers['x-demo-token'])) {
    throw new AppError(401, 'Invalid token', 'UNAUTHORIZED');
  }
  await runReset(res);
}

export async function adminReset(_req: Request, res: Response) {
  ensureDemoMode();
  await runReset(res);
}
