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

// Add type definition for process.env.API_KEY to satisfy TypeScript
// and adhere to Gemini API guidelines for key management.
// This is a type declaration and does not define the variable at runtime.
// FIX: Changed from `declare var process` to `declare namespace NodeJS` to extend
// the global process type instead of overwriting it. This fixes errors with
// `process.cwd()` in vite.config.ts and redeclaration errors.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly API_KEY: string;
  }
}
