import type { Handler, HandlerEvent } from "@netlify/functions";
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Fallback model if the requested one is unavailable (e.g. preview not enabled). */
const FALLBACK_MODEL = 'gemini-2.0-flash';

type NormalizedResponse = {
  text: string | null;
  candidates?: unknown[];
  functionCalls?: unknown;
};

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /quota|resource_exhausted|429|rate.?limit/i.test(msg);
}

function isModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /model|404|not found|invalid model|unsupported/i.test(msg) ||
    (msg.includes('400') && /model|name/i.test(msg))
  );
}

function extractText(response: GenerateContentResponse): string | undefined {
  if (typeof (response as { text?: string }).text === 'string') {
    return (response as { text: string }).text;
  }
  const data = response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const candidates = data.candidates;
  const part = candidates?.[0]?.content?.parts?.[0];
  return part && 'text' in part ? String(part.text) : undefined;
}

function normalizeContentsToPrompt(contents: unknown): string {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    // Gemini-style: [{parts:[{text}]}] or similar
    const parts: string[] = [];
    for (const item of contents as any[]) {
      if (item && Array.isArray(item.parts)) {
        for (const p of item.parts) {
          if (p && typeof p.text === 'string') parts.push(p.text);
        }
      }
    }
    if (parts.length) return parts.join('\n\n');
  }
  if (contents && typeof contents === 'object') {
    const c = contents as any;
    if (Array.isArray(c.parts)) {
      const parts: string[] = [];
      for (const p of c.parts) {
        if (p && typeof p.text === 'string') parts.push(p.text);
      }
      if (parts.length) return parts.join('\n\n');
    }
  }
  return typeof contents === 'string' ? contents : JSON.stringify(contents);
}

async function callGemini(
  apiKey: string,
  requestedModel: string,
  contents: unknown,
  config: unknown
): Promise<NormalizedResponse> {
  const ai = new GoogleGenAI({ apiKey });
  const payload = { model: requestedModel, contents, config };
  try {
    const response = await ai.models.generateContent(payload);
    const text = extractText(response);
    return {
      text: text ?? null,
      candidates: response.candidates ?? [],
      functionCalls: (response as any).functionCalls ?? undefined,
    };
  } catch (firstError) {
    if (isModelError(firstError) && requestedModel !== FALLBACK_MODEL) {
      const response = await ai.models.generateContent({ ...payload, model: FALLBACK_MODEL });
      const text = extractText(response);
      return {
        text: text ?? null,
        candidates: response.candidates ?? [],
        functionCalls: (response as any).functionCalls ?? undefined,
      };
    }
    throw firstError;
  }
}

async function callClaude(
  contents: unknown,
  config: unknown
): Promise<NormalizedResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment variables.');
  }
  const prompt = normalizeContentsToPrompt(contents);
  const systemInstruction =
    (config as any)?.systemInstruction && typeof (config as any).systemInstruction === 'string'
      ? (config as any).systemInstruction
      : undefined;

  const body: any = {
    model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
    max_tokens: 1500,
    messages: [
      ...(systemInstruction
        ? [{ role: 'system', content: systemInstruction }]
        : []),
      { role: 'user', content: prompt },
    ],
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': process.env.CLAUDE_API_VERSION || '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  const json = (await response.json()) as {
    content?: Array<{ text?: string }>;
  };

  const text = json.content && json.content[0] && typeof json.content[0].text === 'string'
    ? json.content[0].text
    : null;

  return { text, candidates: [], functionCalls: undefined };
}

async function callOpenAI(
  contents: unknown,
  config: unknown
): Promise<NormalizedResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables.');
  }
  const prompt = normalizeContentsToPrompt(contents);
  const systemInstruction =
    (config as any)?.systemInstruction && typeof (config as any).systemInstruction === 'string'
      ? (config as any).systemInstruction
      : undefined;

  const body: any = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    max_tokens: 1500,
    messages: [
      ...(systemInstruction
        ? [{ role: 'system', content: systemInstruction }]
        : []),
      { role: 'user', content: prompt },
    ],
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text =
    json.choices &&
    json.choices[0] &&
    json.choices[0].message &&
    typeof json.choices[0].message.content === 'string'
      ? json.choices[0].message.content
      : null;

  return { text, candidates: [], functionCalls: undefined };
}

async function callGrok(
  contents: unknown,
  config: unknown
): Promise<NormalizedResponse> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY is not set in environment variables.');
  }
  const prompt = normalizeContentsToPrompt(contents);
  const systemInstruction =
    (config as any)?.systemInstruction && typeof (config as any).systemInstruction === 'string'
      ? (config as any).systemInstruction
      : undefined;

  const body: any = {
    model: process.env.GROK_MODEL || 'grok-4-0709',
    messages: [
      ...(systemInstruction
        ? [{ role: 'system', content: systemInstruction }]
        : []),
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 1500,
  };

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grok API error ${response.status}: ${errorText}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text =
    json.choices &&
    json.choices[0] &&
    json.choices[0].message &&
    typeof json.choices[0].message.content === 'string'
      ? json.choices[0].message.content
      : null;

  return { text, candidates: [], functionCalls: undefined };
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    if (!event.body) {
      throw new Error("Request body is missing.");
    }
    const body = JSON.parse(event.body) as { model?: string; contents?: unknown; config?: unknown; health?: boolean; type?: string; mode?: string };
    const { model: requestedModel, contents, config } = body;
    const healthMode = body?.health === true || body?.type === 'health' || body?.mode === 'health';
    const primaryApiKey = process.env.GEMINI_API_KEY;
    const backupApiKey = process.env.GEMINI_API_KEY_BACKUP;

    if (healthMode) {
      const geminiConfigured = Boolean(primaryApiKey || backupApiKey);
      const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
      const grokConfigured = Boolean(process.env.GROK_API_KEY);
      const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
      const anyProviderConfigured = geminiConfigured || anthropicConfigured || grokConfigured || openaiConfigured;
      return {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: true,
          anyProviderConfigured,
          providers: {
            gemini: { configured: geminiConfigured, primaryConfigured: Boolean(primaryApiKey), backupConfigured: Boolean(backupApiKey) },
            anthropic: { configured: anthropicConfigured },
            grok: { configured: grokConfigured },
            openai: { configured: openaiConfigured },
          },
        }),
      };
    }

    if (!requestedModel || !contents) {
      throw new Error("Request body must include 'model' and 'contents'.");
    }

    let lastError: unknown = null;

    // 1) Try Gemini (primary, then backup on any failure — quota, timeout, etc.)
    if (primaryApiKey || backupApiKey) {
      for (const key of [primaryApiKey, backupApiKey].filter(Boolean)) {
        try {
          if (!key) continue;
          const result = await callGemini(key, requestedModel, contents, config);
          return {
            statusCode: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            body: JSON.stringify(result),
          };
        } catch (geminiErr) {
          lastError = geminiErr;
          if (key === primaryApiKey && backupApiKey) {
            console.warn('Gemini proxy: primary failed, retrying with backup key.');
          }
        }
      }
    }

    // 2) Try Claude (Anthropic) if available
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const result = await callClaude(contents, config);
        return {
          statusCode: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(result),
        };
      } catch (claudeError) {
        lastError = claudeError;
      }
    }

    // 3) Try Grok (xAI) if available
    if (process.env.GROK_API_KEY) {
      try {
        const result = await callGrok(contents, config);
        return {
          statusCode: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(result),
        };
      } catch (grokError) {
        lastError = grokError;
      }
    }

    // 4) Try OpenAI if available
    if (process.env.OPENAI_API_KEY) {
      try {
        const result = await callOpenAI(contents, config);
        return {
          statusCode: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(result),
        };
      } catch (openaiError) {
        lastError = openaiError;
      }
    }

    if (!primaryApiKey && !backupApiKey && !process.env.ANTHROPIC_API_KEY && !process.env.GROK_API_KEY && !process.env.OPENAI_API_KEY) {
      throw new Error("No AI providers configured. Set at least one: GEMINI_API_KEY, GEMINI_API_KEY_BACKUP, ANTHROPIC_API_KEY, GROK_API_KEY, or OPENAI_API_KEY.");
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error('AI proxy invocation failed for all configured providers.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in Gemini/Grok/Claude proxy function:", error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: message }),
    };
  }
};

export { handler };
