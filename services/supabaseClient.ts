
import { createClient } from '@supabase/supabase-js';

const createSupabaseClient = () => {
    // FIX: Use process.env for environment variables consistently to resolve TypeScript errors.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
};

export const supabase = createSupabaseClient();