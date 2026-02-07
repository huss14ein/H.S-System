import { createClient } from '@supabase/supabase-js';

const createSupabaseClient = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not configured. Supabase client will not be initialized.");
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = createSupabaseClient();