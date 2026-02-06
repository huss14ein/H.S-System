// FIX: The reference to "vite/client" was causing a resolution error. It has been removed.
// The interfaces below provide the necessary types for import.meta.env.

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_GEMINI_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
