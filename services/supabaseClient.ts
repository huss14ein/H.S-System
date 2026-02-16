import { createClient } from '@supabase/supabase-js';

let hasLoggedSupabaseError = false;

const createSupabaseClient = () => {
    // Use import.meta.env for Vite projects, which is the correct way to access env variables
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      if (!hasLoggedSupabaseError) {
        console.error('Supabase is not configured. Authentication and database features will be disabled. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file for data persistence.');
        hasLoggedSupabaseError = true;
      }
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
};

export const supabase = createSupabaseClient();