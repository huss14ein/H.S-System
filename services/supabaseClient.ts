import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

export let isSupabaseConfigured = true;

if (!supabaseUrl || !supabaseAnonKey) {
  isSupabaseConfigured = false;
  console.error(
    "CRITICAL: Supabase environment variables SUPABASE_URL and SUPABASE_ANON_KEY are missing. " +
    "Authentication and data services will fail. " +
    "Using dummy values to allow the application to load."
  );
}

// Use dummy values if real ones are missing to prevent a hard crash on module load.
// API calls will be blocked by the AuthContext to prevent network errors.
export const supabase = createClient(
  supabaseUrl || "http://localhost:8000",
  supabaseAnonKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
);