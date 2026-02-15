// FIX: The reference to "vite/client" was causing a type resolution error.
// The reference has been commented out and the env types are defined explicitly below,
// which is sufficient for this project's needs.
// /// <reference types="vite/client" />

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      VITE_SUPABASE_URL: string;
      VITE_SUPABASE_ANON_KEY: string;
      VITE_GEMINI_API_KEY?: string;
    }
  }
}

export {};
