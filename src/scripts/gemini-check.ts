import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { toolDeclarations } from '../copilot/tools';

function describe(error: unknown) {
  if (error && typeof error === 'object') {
    const { status, message } = error as { status?: number; message?: string };
    return `  status:  ${status ?? 'unknown'}\n  message: ${message ?? String(error)}`;
  }
  return `  ${String(error)}`;
}

async function attempt(name: string, run: () => Promise<string>) {
  try {
    console.log(`PASS  ${name}: ${await run()}`);
  } catch (error) {
    console.log(`FAIL  ${name}`);
    console.log(describe(error));
    process.exitCode = 1;
  }
}

async function main() {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set in .env');
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  console.log(`model: ${env.GEMINI_MODEL}`);

  await attempt('plain request', async () => {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: 'Reply with the single word: ok',
    });
    return response.text ?? '';
  });

  await attempt('request with the copilot tools', async () => {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: 'What is live right now?',
      config: { tools: [{ functionDeclarations: toolDeclarations }] },
    });
    return `${response.functionCalls?.length ?? 0} tool call(s)`;
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
