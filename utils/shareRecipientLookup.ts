import { supabase } from '../services/supabaseClient';

/** Resolve a share recipient by email only (no user directory enumeration). */
export async function resolveRecipientUserByEmail(email: string): Promise<{
  data: { id: string; email: string } | null;
  error: { message: string } | null;
}> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { data: null, error: { message: 'Enter a recipient email.' } };
  }
  if (!supabase) {
    return { data: null, error: { message: 'Supabase client is unavailable.' } };
  }

  const rpcLookup = await supabase.rpc('find_user_by_email', { target_email: normalized });
  const rpcRow = Array.isArray(rpcLookup.data) ? rpcLookup.data[0] : rpcLookup.data;
  if (rpcRow?.id) {
    return {
      data: { id: String(rpcRow.id), email: String(rpcRow.email ?? normalized).toLowerCase() },
      error: null,
    };
  }

  const baseMessage = rpcLookup.error?.message || 'Recipient user not found.';
  const normalizedMessage = /column\s+users\.email\s+does not exist/i.test(baseMessage)
    ? 'Recipient lookup needs the latest budget-sharing migration (find_user_by_email).'
    : baseMessage;

  return { data: null, error: { message: normalizedMessage } };
}
