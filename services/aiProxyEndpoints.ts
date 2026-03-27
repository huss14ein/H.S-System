/**
 * Single source of truth for the Netlify `gemini-proxy` function URLs.
 * Production: `netlify.toml` rewrites `/api/*` → `/.netlify/functions/:splat`.
 * Local: `@netlify/vite-plugin` emulates the same routing so `npm run dev` hits the real function.
 *
 * Optional: set `VITE_AI_PROXY_EXTRA_ORIGIN` (e.g. `https://your-site.netlify.app`) to try that
 * origin first when the app is served from a host without functions (advanced / debugging).
 */
export function getGeminiProxyEndpoints(): string[] {
    const paths = ['/api/gemini-proxy', '/.netlify/functions/gemini-proxy'];
    try {
        const extra =
            typeof import.meta !== 'undefined' &&
            (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_AI_PROXY_EXTRA_ORIGIN;
        const origin = typeof extra === 'string' ? extra.replace(/\/$/, '').trim() : '';
        if (origin && /^https?:\/\//i.test(origin)) {
            return [...paths.map((p) => `${origin}${p}`), ...paths];
        }
    } catch {
        /* ignore */
    }
    return paths;
}

export type GeminiProxyHealthResult = {
    /** At least one endpoint returned HTTP 200 with valid JSON health payload. */
    reachable: boolean;
    /** Proxy reports `anyProviderConfigured` (GEMINI / Anthropic / OpenAI / Grok env on server). */
    configured: boolean;
};

/**
 * Shared health probe for AiContext + `probeGeminiProxyHealth`.
 * Rejects HTML/SPA fallbacks: requires `Content-Type` JSON and `anyProviderConfigured` in body.
 */
export async function fetchGeminiProxyHealthStatus(signal?: AbortSignal): Promise<GeminiProxyHealthResult> {
    const endpoints = getGeminiProxyEndpoints();
    for (const endpoint of endpoints) {
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ health: true }),
                signal,
            });
            if (!res.ok) continue;
            const ct = res.headers.get('content-type') ?? '';
            if (!/json/i.test(ct)) continue;
            const json = (await res.json().catch(() => null)) as { anyProviderConfigured?: boolean } | null;
            if (!json || typeof json !== 'object' || !('anyProviderConfigured' in json)) continue;
            const configured = Boolean(json.anyProviderConfigured);
            return { reachable: true, configured };
        } catch {
            continue;
        }
    }
    return { reachable: false, configured: false };
}
