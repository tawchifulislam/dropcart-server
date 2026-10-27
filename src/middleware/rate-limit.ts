import { rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/AppError';
import { currentUserId } from './auth';

function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => currentUserId(req),
    handler: (_req, _res, next) =>
      next(new AppError(429, message, 'RATE_LIMITED')),
  });
}

export const copilotLimits = [
  limiter(
    60_000,
    6,
    'You are sending messages too quickly. Please wait a minute.',
  ),
  limiter(
    86_400_000,
    60,
    "You have reached today's Copilot limit. Please come back tomorrow.",
  ),
];
