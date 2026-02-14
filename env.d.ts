// FIX: The reference to "vite/client" was causing a type resolution error.
// The reference has been commented out and the env types are defined explicitly below,
// which is sufficient for this project's needs.
// /// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // FIX: Added VITE_API_KEY which is used in vite.config.ts
  readonly VITE_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
