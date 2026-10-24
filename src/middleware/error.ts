import { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { AppError } from '../utils/AppError';

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

function isMalformedJson(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  );
}

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'Route not found'));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res
      .status(400)
      .json({ error: 'Validation failed', details: z.flattenError(err) });
    return;
  }
  if (isMalformedJson(err)) {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  if (isDuplicateKeyError(err)) {
    res.status(409).json({ error: 'A record with this value already exists' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
