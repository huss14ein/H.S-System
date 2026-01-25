
import { createClient } from '@supabase/supabase-js';

// FIX: Cast `import.meta` to `any` to access `env` without adding a new type definition file.
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
// FIX: Cast `import.meta` to `any` to access `env` without adding a new type definition file.
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL and Anon Key must be provided as environment variables.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
