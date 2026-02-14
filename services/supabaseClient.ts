import { createClient } from '@supabase/supabase-js';

const createSupabaseClient = () => {
    // Use import.meta.env for Vite projects, which is the correct way to access env variables
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.');
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
};

export const supabase = createSupabaseClient();