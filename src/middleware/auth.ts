import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { Role, User } from '../models/User';
import { AppError } from '../utils/AppError';

export interface AuthPayload {
  sub: string;
  role: 'shopper' | 'admin';
}

export interface Actor {
  id: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      actor?: Actor;
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

export function currentUserId(req: Request) {
  const userId = req.auth?.sub;
  if (!userId)
    throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
  return userId;
}

export function requireRole(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = await User.findById(currentUserId(req))
      .select('role')
      .lean<{ _id: Types.ObjectId; role: Role }>();
    if (!user || !roles.includes(user.role)) {
      throw new AppError(
        403,
        'You do not have access to this area',
        'FORBIDDEN',
      );
    }
    req.actor = { id: user._id.toString(), role: user.role };
    next();
  };
}

export function currentActor(req: Request) {
  if (!req.actor)
    throw new AppError(403, 'You do not have access to this area', 'FORBIDDEN');
  return req.actor;
}
