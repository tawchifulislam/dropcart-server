import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export interface AuthPayload {
  sub: string;
  role: 'shopper' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export const AUTH_COOKIE = 'dropcart_token';

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return next(new AppError(401, 'Authentication required'));

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string' || !decoded.sub)
      throw new Error('Malformed token');
    req.auth = {
      sub: decoded.sub,
      role: decoded.role === 'admin' ? 'admin' : 'shopper',
    };
    next();
  } catch {
    next(new AppError(401, 'Invalid or expired session'));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.role !== 'admin')
    return next(new AppError(403, 'Admin access required'));
  next();
}
export function currentUserId(req: Request) {
  const userId = req.auth?.sub;
  if (!userId)
    throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
  return userId;
}
