import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env';
import { AUTH_COOKIE } from '../middleware/auth';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';

const email = z.string().trim().toLowerCase().pipe(z.email());

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1),
});

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
} as const;

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

function startSession(res: Response, user: SessionUser) {
  const token = jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_TTL_SECONDS,
  });
  res.cookie(AUTH_COOKIE, token, {
    ...baseCookie,
    maxAge: env.JWT_TTL_SECONDS * 1000,
  });
}

const publicUser = (user: SessionUser) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  if (await User.exists({ email: input.email })) {
    throw new AppError(409, 'An account with this email already exists');
  }
  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash: await bcrypt.hash(input.password, 12),
  });
  startSession(res, user);
  res.status(201).json({ user: publicUser(user) });
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const user = await User.findOne({ email: input.email }).select(
    '+passwordHash',
  );
  const valid = user
    ? await bcrypt.compare(input.password, user.passwordHash)
    : false;
  if (!user || !valid) throw new AppError(401, 'Invalid email or password');
  startSession(res, user);
  res.json({ user: publicUser(user) });
}

export function logout(_req: Request, res: Response) {
  res.clearCookie(AUTH_COOKIE, baseCookie);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const user = await User.findById(req.auth?.sub);
  if (!user) throw new AppError(401, 'Account no longer exists');
  res.json({ user: publicUser(user) });
}
