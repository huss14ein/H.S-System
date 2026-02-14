// FIX: Removed vite/client reference to resolve TypeScript errors.
import { createClient } from '@supabase/supabase-js';

const createSupabaseClient = () => {
    // FIX: Use process.env to avoid errors with import.meta.env.
    const supabaseUrl = process.env.SUPABASE_URL;
    // FIX: Use process.env to avoid errors with import.meta.env.
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      // FIX: Update error message to be consistent with using process.env.
      console.error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
};

export const supabase = createSupabaseClient();