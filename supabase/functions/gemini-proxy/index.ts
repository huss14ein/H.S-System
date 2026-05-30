import { GoogleGenAI, GenerateContentResponse } from "https://esm.sh/@google/genai@1.40.0";
import { jwtVerify } from "https://esm.sh/jose@5.10.0";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

function canonicalOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

function allowedOrigins(): Set<string> {
  const set = new Set<string>();
  const extras = String(Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
  for (const e of extras) {
    const o = canonicalOrigin(e);
    if (o) set.add(o);
  }
  for (const key of ["VITE_CANONICAL_APP_URL", "VERCEL_URL", "VERCEL_BRANCH_URL"] as const) {
    const v = Deno.env.get(key)?.trim();
    if (!v) continue;
    const o = canonicalOrigin(v);
    if (o) set.add(o);
  }
  return set;
}

function corsHeadersForRequest(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin")?.trim();
  const base = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin && allowedOrigins().has(origin)) {
    return { ...base, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return base;
}

function isJwtGateEnabled(): boolean {
  const v = (Deno.env.get("PROXY_REQUIRE_SUPABASE_JWT") ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  if (v === "1" || v === "true" || v === "yes") return true;
  return Boolean(Deno.env.get("SUPABASE_JWT_SECRET")?.trim());
}

async function verifySupabaseAccessToken(req: Request): Promise<boolean> {
  const secret = Deno.env.get("SUPABASE_JWT_SECRET")?.trim();
  if (!secret) return false;
  const auth = req.headers.get("Authorization");
  const m = auth && /^Bearer\s+(\S+)/i.exec(auth.trim());
  const token = m?.[1]?.trim();
  if (!token) return false;
  const base = Deno.env.get("SUPABASE_URL")?.trim().replace(/\/$/, "");
  const issuer = base ? `${base}/auth/v1` : undefined;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      ...(issuer ? { issuer } : {}),
    });
    return Boolean(payload.sub);
  } catch {
    return false;
  }
}

serve(async (req: Request) => {
  const cors = corsHeadersForRequest(req);

  if (req.method === "OPTIONS") {
    const origin = req.headers.get("Origin")?.trim();
    if (origin && !allowedOrigins().has(origin)) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const { model, contents, config, health } = (await req.json()) as {
      model?: string;
      contents?: unknown;
      config?: unknown;
      health?: boolean;
    };

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const grokApiKey = Deno.env.get("GROK_API_KEY");

    if (health === true) {
      const geminiConfigured = Boolean(geminiApiKey);
      const anthropicConfigured = Boolean(anthropicApiKey);
      const grokConfigured = Boolean(grokApiKey);
      const anyProviderConfigured = geminiConfigured || anthropicConfigured || grokConfigured;

      return new Response(
        JSON.stringify({
          ok: true,
          anyProviderConfigured,
          providers: {
            gemini: { configured: geminiConfigured },
            anthropic: { configured: anthropicConfigured },
            grok: { configured: grokConfigured },
          },
        }),
        {
          headers: { ...cors, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (isJwtGateEnabled()) {
      const ok = await verifySupabaseAccessToken(req);
      if (!ok) {
        return new Response(
          JSON.stringify({
            error:
              "Authentication required. Send Authorization: Bearer <Supabase access_token> from a signed-in session.",
          }),
          { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
    }

    const apiKey = geminiApiKey;

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not set in Supabase environment variables.");
    }

    const ai = new GoogleGenAI({ apiKey });

    const response: GenerateContentResponse = await ai.models.generateContent({ model, contents, config });

    const result = {
      text: response.text,
      candidates: response.candidates,
      functionCalls: response.functionCalls,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in Gemini proxy function:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
