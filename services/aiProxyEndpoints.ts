/**
 * Single source of truth for Netlify `gemini-proxy` URLs. Provider keys are read only in the function from
 * Netlify Site → Environment variables (`process.env`), never in the client bundle.
 *
 * `netlify.toml` rewrites `/api/*` → `/.netlify/functions/:splat`.
 * Optional `VITE_AI_PROXY_EXTRA_ORIGIN`: absolute URLs appended after same-host `/api/*` (cross-host debugging only).
 */
export function getGeminiProxyEndpoints(): string[] {
    const paths = ['/api/gemini-proxy'];
    try {
        const extra =
            typeof import.meta !== 'undefined' &&
            (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_AI_PROXY_EXTRA_ORIGIN;
        const origin = typeof extra === 'string' ? extra.replace(/\/$/, '').trim() : '';
        if (!origin || !/^https?:\/\//i.test(origin)) {
            return paths;
        }
        if (typeof window !== 'undefined' && window.location?.origin) {
            try {
                if (new URL(origin).origin === window.location.origin) {
                    return paths;
                }
            } catch {
                /* ignore */
            }
        }
        return [...paths, ...paths.map((p) => `${origin}${p}`)];
    } catch {
        /* ignore */
    }
    return paths;
}

/** When `reachable` is false, best-effort reason (403 CORS, HTML shell instead of function, or network/parse). */
export type GeminiProxyUnreachableReason = 'origin_forbidden' | 'spa_shell' | 'unreachable';

export type GeminiProxyHealthResult = {
    /** At least one endpoint returned HTTP 200 with a parseable health JSON body */
    reachable: boolean;
    /** Proxy reports `anyProviderConfigured` (GEMINI / Anthropic / OpenAI / Grok env on server) */
    configured: boolean;
    unreachableReason?: GeminiProxyUnreachableReason;
};

function bodyLooksLikeSpaOrHtmlShell(raw: string): boolean {
    const t = raw.trimStart();
    if (!t) return false;
    const head = t.slice(0, 12).toLowerCase();
    return head.startsWith('<!doctype h') || head.startsWith('<!') || head.startsWith('<html');
}

function parseHealthJsonPayload(raw: string): { anyProviderConfigured?: boolean } | null {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
        return JSON.parse(trimmed) as { anyProviderConfigured?: boolean };
    } catch {
        return null;
    }
}

/**
 * Shared health probe for AiContext + `probeGeminiProxyHealth`.
 * Retries a few times (dev server / cold function). Accepts JSON bodies even if Content-Type is wrong (SPA fallback is rejected).
 */
export async function fetchGeminiProxyHealthStatus(signal?: AbortSignal): Promise<GeminiProxyHealthResult> {
    const endpoints = getGeminiProxyEndpoints();
    const maxRounds = 3;
    let sawOriginForbidden403 = false;
    let sawSpaShell = false;
    const relativeEndpoints = endpoints.filter((u) => u.startsWith('/'));

    for (let round = 0; round < maxRounds; round++) {
        if (round > 0) {
            await new Promise((r) => setTimeout(r, 320 * round));
        }
        for (const endpoint of endpoints) {
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ health: true }),
                    signal,
                    cache: 'no-store',
                });
                const raw = await res.text();
                if (!res.ok) {
                    const isRelative = endpoint.startsWith('/');
                    if (res.status === 403 && isRelative) {
                        try {
                            const errJson = JSON.parse(raw) as { error?: string };
                            if (typeof errJson.error === 'string' && /origin not allowed/i.test(errJson.error)) {
                                sawOriginForbidden403 = true;
                            }
                        } catch {
                            if (/origin not allowed/i.test(raw)) sawOriginForbidden403 = true;
                        }
                    }
                    continue;
                }

                if (bodyLooksLikeSpaOrHtmlShell(raw)) {
                    sawSpaShell = true;
                    continue;
                }

                const ct = res.headers.get('content-type') ?? '';
                let parsed: unknown = null;
                if (/json/i.test(ct)) {
                    try {
                        parsed = JSON.parse(raw);
                    } catch {
                        parsed = null;
                    }
                }
                if (parsed === null) {
                    parsed = parseHealthJsonPayload(raw);
                }
                if (!parsed || typeof parsed !== 'object' || parsed === null) {
                    continue;
                }
                if (!('anyProviderConfigured' in parsed)) continue;

                const configured = Boolean((parsed as { anyProviderConfigured?: boolean }).anyProviderConfigured);
                return { reachable: true, configured };
            } catch {
                continue;
            }
        }
    }

    const unreachableReason: GeminiProxyUnreachableReason =
        sawOriginForbidden403 && relativeEndpoints.length > 0
        ? 'origin_forbidden'
        : sawSpaShell
          ? 'spa_shell'
          : 'unreachable';

    return { reachable: false, configured: false, unreachableReason };
}
