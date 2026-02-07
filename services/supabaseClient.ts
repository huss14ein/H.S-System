import { createClient } from '@supabase/supabase-js';

const createSupabaseClient = () => {
    // Use non-VITE prefixed variables, aligning with how the Gemini API_KEY is provided.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("SUPABASE_URL and SUPABASE_ANON_KEY are not configured. Supabase client will not be initialized.");
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = createSupabaseClient();