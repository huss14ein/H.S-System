
import { createClient } from '@supabase/supabase-js';

// FIX: Cast `import.meta` to `any` to resolve TypeScript error about missing 'env' property.
// This is a workaround due to the constraint of not being able to add new type definition files (e.g., vite-env.d.ts).
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL and Anon Key must be provided as environment variables.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
