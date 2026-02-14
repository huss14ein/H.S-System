import { createClient } from '@supabase/supabase-js';

let hasLoggedSupabaseError = false;

const createSupabaseClient = () => {
    // Use process.env as this app's runtime environment provides variables there,
    // not through Vite's import.meta.env mechanism.
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      if (!hasLoggedSupabaseError) {
        console.error('Supabase is not configured. AI features will be disabled. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
        hasLoggedSupabaseError = true;
      }
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
};

export const supabase = createSupabaseClient();