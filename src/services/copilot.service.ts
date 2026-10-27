import { type Content, GoogleGenAI, type Part } from '@google/genai';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { SYSTEM_PROMPT } from '../copilot/prompt';
import { executeTool, toolDeclarations } from '../copilot/tools';
import type { CopilotAction, ProductCard } from '../copilot/types';
import { ChatSession, ChatSessionRecord } from '../models/ChatSession';
import { AppError } from '../utils/AppError';

const MAX_STEPS = 4;
const MAX_TURNS = 10;
const MAX_STORED_MESSAGES = 60;
const MAX_CARDS = 4;

interface StoredMessage {
  _id: Types.ObjectId;
  role: 'user' | 'assistant';
  text: string;
  trace: string[];
  products: ProductCard[];
  actions: CopilotAction[];
  createdAt: Date;
}

let client: GoogleGenAI | null = null;

function getClient() {
  if (!env.GEMINI_API_KEY) {
    throw new AppError(
      503,
      'The Copilot is not configured yet',
      'AI_NOT_CONFIGURED',
    );
  }
  client ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

const isUserText = (content: Content) =>
  content.role === 'user' &&
  (content.parts ?? []).some((part) => typeof part.text === 'string');

function trimHistory(history: Content[]) {
  const starts = history.flatMap((content, index) =>
    isUserText(content) ? [index] : [],
  );
  if (starts.length <= MAX_TURNS) return history;
  return history.slice(starts[starts.length - MAX_TURNS]);
}

async function generate(history: Content[]) {
  try {
    return await getClient().models.generateContent({
      model: env.GEMINI_MODEL,
      contents: history,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: toolDeclarations }],
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Gemini request failed', error);
    throw new AppError(
      502,
      'The assistant is unavailable right now. Please try again.',
      'AI_UNAVAILABLE',
    );
  }
}

const toView = (message: StoredMessage) => ({
  id: message._id.toString(),
  role: message.role,
  text: message.text,
  trace: message.trace,
  products: message.products,
  actions: message.actions,
  createdAt: message.createdAt,
});

export async function runCopilot(userId: string, text: string) {
  const session = await ChatSession.findOne({
    user: userId,
  }).lean<ChatSessionRecord>();
  const history = trimHistory([
    ...((session?.history ?? []) as Content[]),
    { role: 'user', parts: [{ text }] },
  ]);

  const trace: string[] = [];
  const actions: CopilotAction[] = [];
  const cards = new Map<string, ProductCard>();
  let reply = '';

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const response = await generate(history);
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) history.push(modelContent);

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      reply = response.text?.trim() ?? '';
      break;
    }

    const parts: Part[] = [];
    for (const call of calls) {
      const outcome = await executeTool(
        call.name ?? '',
        (call.args ?? {}) as Record<string, unknown>,
        {
          userId,
        },
      );
      if (outcome.trace) trace.push(outcome.trace);
      outcome.products?.forEach((card) => cards.set(card.id, card));
      actions.push(...(outcome.actions ?? []));
      parts.push({
        functionResponse: {
          name: call.name,
          response: outcome.response,
          ...(call.id ? { id: call.id } : {}),
        },
      });
    }
    history.push({ role: 'user', parts });
  }

  if (!reply) {
    reply = 'Sorry, I could not finish that request. Please try again.';
    if (history.at(-1)?.role === 'model') history.pop();
    history.push({ role: 'model', parts: [{ text: reply }] });
  }

  const userMessage: StoredMessage = {
    _id: new Types.ObjectId(),
    role: 'user',
    text,
    trace: [],
    products: [],
    actions: [],
    createdAt: new Date(),
  };
  const assistantMessage: StoredMessage = {
    _id: new Types.ObjectId(),
    role: 'assistant',
    text: reply,
    trace,
    products: [...cards.values()].slice(0, MAX_CARDS),
    actions,
    createdAt: new Date(),
  };

  await ChatSession.updateOne(
    { user: userId },
    {
      $set: { history },
      $push: {
        messages: {
          $each: [userMessage, assistantMessage],
          $slice: -MAX_STORED_MESSAGES,
        },
      },
    },
    { upsert: true },
  );

  return toView(assistantMessage);
}

export async function getSessionMessages(userId: string) {
  const session = await ChatSession.findOne({
    user: userId,
  }).lean<ChatSessionRecord>();
  return (session?.messages ?? []).map((message) =>
    toView(message as StoredMessage),
  );
}

export async function resetSession(userId: string) {
  await ChatSession.deleteOne({ user: userId });
}
