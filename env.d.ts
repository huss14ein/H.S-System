// The original reference `/// <reference types="vite/client" />` was causing a build error.
// This file now manually defines the ImportMeta interface to provide types for environment variables,
// resolving type errors for `import.meta.env` across the project.

interface ImportMetaEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
