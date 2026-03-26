// FIX: The reference to "vite/client" was causing a type resolution error.
// The reference has been commented out and the env types are defined explicitly below,
// which is sufficient for this project's needs.
// /// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // FIX: Add DEV property for Vite's dev mode flag, used in geminiService.ts.
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_FINNHUB_API_KEY?: string;
  readonly VITE_LIVE_PRICE_PROVIDER?: "auto" | "ai" | "finnhub" | "stooq";
  /** When 'true', sign-up link is shown on login. Omit or 'false' to disable. */
  readonly VITE_ALLOW_SIGNUP?: string;
  /** '1' = always use Netlify proxy for Stooq; '0' = never (direct fetch; may fail CORS in browser). */
  readonly VITE_STOOQ_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
