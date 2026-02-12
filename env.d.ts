// FIX: Define types for process.env to resolve TypeScript errors.
declare var process: {
  env: {
    API_KEY?: string;
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    [key: string]: string | undefined;
  }
}
