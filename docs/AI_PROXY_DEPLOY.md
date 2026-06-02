# AI proxy — deploy and verify (Executive Summary)

## Path (browser → Netlify function)

1. Dashboard **Executive Summary** → `AiContext` → `fetchGeminiProxyHealthStatus()`
2. `POST /api/gemini-proxy` with `{"health":true}` (same host as the SPA)
3. `netlify.toml` + `public/_redirects` rewrite `/api/*` → `/.netlify/functions/gemini-proxy`
4. Function returns `{ anyProviderConfigured: true/false }` when keys exist in Netlify env

## Required for production

| Step | Action |
|------|--------|
| **Code on `main`** | Merge branch with `corsAllowlist` same-host + `gemini-proxy` health bypass |
| **Netlify deploy** | Trigger deploy after merge |
| **Function env** | `GEMINI_API_KEY` (or Anthropic/OpenAI) — scope **Functions** or **All** |
| **Production URL** | Site must return **200** on `/` (not 404) |

## Verify after deploy

```bash
ORIGIN="https://YOUR-LIVE-SITE.netlify.app"
curl -sf -X POST "$ORIGIN/api/gemini-proxy" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"health":true}'
```

Expected: JSON with `"anyProviderConfigured":true` (not `"error":"Origin not allowed"`).

Local wiring tests: `npm run verify:ai-proxy-wiring`
