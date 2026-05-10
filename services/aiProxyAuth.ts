/**
 * Supplies the Supabase session access token for Netlify proxy calls when the server
 * enforces `PROXY_REQUIRE_SUPABASE_JWT`. Registered once from `AuthContext`.
 */
let getAccessToken: (() => Promise<string | null>) | null = null;

export function registerAiProxyAuth(getter: () => Promise<string | null>): void {
  getAccessToken = getter;
}

export async function getAiProxyAuthorizationHeader(): Promise<Record<string, string>> {
  if (!getAccessToken) return {};
  try {
    const token = await getAccessToken();
    if (token && token.trim()) {
      return { Authorization: `Bearer ${token.trim()}` };
    }
  } catch {
    /* ignore */
  }
  return {};
}
