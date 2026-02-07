// This file now manually defines the ImportMeta interface to provide types for environment variables,
// resolving type errors for `import.meta.env` across the project.

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
