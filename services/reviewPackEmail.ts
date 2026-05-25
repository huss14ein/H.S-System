import { supabase } from './supabaseClient';

export type ReviewPackEmailResult = { ok: true } | { ok: false; error: string };

/** Sends review pack markdown to the signed-in user's email via Edge Function (Resend/SendGrid). */
export async function sendReviewPackEmail(markdown: string, subject?: string): Promise<ReviewPackEmailResult> {
  if (!supabase) {
    return { ok: false, error: 'Supabase is not configured.' };
  }
  const trimmed = (markdown || '').trim();
  if (!trimmed) return { ok: false, error: 'Review pack is empty.' };

  try {
    const { data, error } = await supabase.functions.invoke('send-review-pack', {
      body: { markdown: trimmed, subject: subject ?? 'Finova review pack' },
    });
    if (error) {
      return { ok: false, error: error.message || 'Email send failed.' };
    }
    const payload = data as { error?: string; message?: string } | null;
    if (payload?.error) return { ok: false, error: payload.error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
