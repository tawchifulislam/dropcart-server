import { Request, Response } from 'express';
import { z } from 'zod';
import { currentUserId } from '../middleware/auth';
import {
  getSessionMessages,
  resetSession,
  runCopilot,
} from '../services/copilot.service';

const chatBody = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Write a message first')
    .max(500, 'Keep messages under 500 characters'),
});

export async function chat(req: Request, res: Response) {
  const { message } = chatBody.parse(req.body);
  res.json({ message: await runCopilot(currentUserId(req), message) });
}

export async function getSession(req: Request, res: Response) {
  res.json({ messages: await getSessionMessages(currentUserId(req)) });
}

export async function clearSession(req: Request, res: Response) {
  await resetSession(currentUserId(req));
  res.status(204).end();
}
