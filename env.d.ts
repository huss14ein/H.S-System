// FIX: The reference to "vite/client" was causing a type resolution error.
// The reference has been commented out and the env types are defined explicitly below,
// which is sufficient for this project's needs.
// /// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// FIX: Replaced `declare const process` with a global augmentation of `NodeJS.ProcessEnv`.
// This avoids redeclaring the `process` variable which is already provided by Node.js types,
// and correctly adds types for environment variables, resolving the "Cannot redeclare block-scoped variable" error.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      VITE_SUPABASE_URL: string;
      VITE_SUPABASE_ANON_KEY: string;
    }
  }
}
