import { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { AppError } from '../utils/AppError';
import { isDuplicateKeyError } from '../utils/mongo';

function isMalformedJson(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  );
}

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'Route not found', 'NOT_FOUND'));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION',
      details: z.flattenError(err),
    });
    return;
  }
  if (isMalformedJson(err)) {
    res.status(400).json({ error: 'Malformed JSON body', code: 'BAD_JSON' });
    return;
  }
  if (isDuplicateKeyError(err)) {
    res.status(409).json({
      error: 'A record with this value already exists',
      code: 'DUPLICATE',
    });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
}
