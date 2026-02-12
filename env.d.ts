// FIX: Correctly augment global process.env types to avoid redeclaration errors.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_KEY?: string;
      SUPABASE_URL?: string;
      SUPABASE_ANON_KEY?: string;
    }
  }
}

export {};
