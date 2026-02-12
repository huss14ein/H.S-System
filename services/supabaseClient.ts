
import { createClient } from '@supabase/supabase-js';

const createSupabaseClient = () => {
    // FIX: Use process.env to resolve TypeScript errors with import.meta.env.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      // FIX: Update error message to reflect new environment variables.
      console.error("SUPABASE_URL and SUPABASE_ANON_KEY are not configured. Supabase client will not be initialized.");
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = createSupabaseClient();
