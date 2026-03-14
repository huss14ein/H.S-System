import type { Handler, HandlerEvent } from "@netlify/functions";
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Fallback model if the requested one is unavailable (e.g. preview not enabled). */
const FALLBACK_MODEL = 'gemini-2.0-flash';

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
    const body = JSON.parse(event.body) as { model?: string; contents?: unknown; config?: unknown };
    const { model: requestedModel, contents, config } = body;
    const primaryApiKey = process.env.GEMINI_API_KEY;
    const backupApiKey = process.env.GEMINI_API_KEY_BACKUP;

    if (!primaryApiKey && !backupApiKey) {
      throw new Error("GEMINI_API_KEY (or GEMINI_API_KEY_BACKUP) is not set in Netlify environment variables.");
    }

    if (!requestedModel || !contents) {
      throw new Error("Request body must include 'model' and 'contents'.");
    }

    const payload = { model: requestedModel, contents, config };

    const generateWithKey = async (apiKey: string): Promise<GenerateContentResponse> => {
      const ai = new GoogleGenAI({ apiKey });
      try {
        return await ai.models.generateContent(payload);
      } catch (firstError) {
        if (isModelError(firstError) && requestedModel !== FALLBACK_MODEL) {
          console.warn("Gemini proxy: primary model failed, retrying with fallback:", (firstError as Error).message);
          return await ai.models.generateContent({ ...payload, model: FALLBACK_MODEL });
        }
        throw firstError;
      }
    };

    let response: GenerateContentResponse;
    try {
      if (!primaryApiKey) throw new Error('Primary key missing.');
      response = await generateWithKey(primaryApiKey);
    } catch (primaryError) {
      if (!backupApiKey || !isQuotaError(primaryError)) {
        throw primaryError;
      }
      console.warn('Gemini proxy: primary key quota-limited, retrying with backup key.');
      response = await generateWithKey(backupApiKey);
    }

    const text = extractText(response);
    const result = {
      text: text ?? null,
      candidates: response.candidates ?? [],
      functionCalls: response.functionCalls ?? undefined,
    };

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in Gemini proxy function:", error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: message }),
    };
  }
};

export { handler };
