import { createClient } from '@supabase/supabase-js';

// FIX: Switched from import.meta.env to process.env to resolve TypeScript error and for broader environment compatibility.
const supabaseUrl = process.env.VITE_SUPABASE_URL;
// FIX: Switched from import.meta.env to process.env to resolve TypeScript error and for broader environment compatibility.
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL and Anon Key must be provided as environment variables.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
