/**
 * Deploy: `supabase functions deploy send-review-pack`
 * Sends Finova review pack markdown to the authenticated user's email (Resend or SendGrid).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.91.1';

declare const Deno: { env: { get(key: string): string | undefined } };

function canonicalOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

function allowedOrigins(): Set<string> {
  const set = new Set<string>([
    'https://h-s-system.vercel.app',
    'https://finova-hussein.netlify.app',
  ]);
  const extras = String(Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const e of extras) {
    const o = canonicalOrigin(e);
    if (o) set.add(o);
  }
  for (const key of ['VITE_CANONICAL_APP_URL', 'FINOVA_CANONICAL_APP_URL'] as const) {
    const v = Deno.env.get(key)?.trim();
    if (!v) continue;
    const o = canonicalOrigin(v);
    if (o) set.add(o);
  }
  return set;
}

function corsHeadersForRequest(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')?.trim();
  const base = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin && allowedOrigins().has(origin)) {
    return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  return base;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownToSimpleHtml(md: string): string {
  const lines = md.split('\n');
  const parts: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      parts.push('<br/>');
      continue;
    }
    if (t.startsWith('# ')) {
      parts.push(`<h1 style="font-size:20px;margin:16px 0 8px;">${escapeHtml(t.slice(2))}</h1>`);
    } else if (t.startsWith('## ')) {
      parts.push(`<h2 style="font-size:16px;margin:14px 0 6px;color:#475569;">${escapeHtml(t.slice(3))}</h2>`);
    } else if (t.startsWith('- ')) {
      parts.push(`<li style="margin:4px 0;">${escapeHtml(t.slice(2))}</li>`);
    } else {
      parts.push(`<p style="margin:6px 0;font-size:14px;line-height:1.5;">${escapeHtml(t)}</p>`);
    }
  }
  return `<div style="font-family:system-ui,sans-serif;color:#334155;">${parts.join('')}</div>`;
}

serve(async (req) => {
  const cors = corsHeadersForRequest(req);

  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('Origin')?.trim();
    if (origin && !allowedOrigins().has(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const origin = req.headers.get('Origin')?.trim();
  if (origin && !allowedOrigins().has(origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { markdown, subject } = await req.json() as { markdown?: string; subject?: string };
    if (!markdown?.trim()) {
      return new Response(JSON.stringify({ error: 'Empty review pack' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const emailApiKey = Deno.env.get('RESEND_API_KEY') || Deno.env.get('SENDGRID_API_KEY');
    const emailFrom = Deno.env.get('EMAIL_FROM') || 'Finova <noreply@finova.app>';
    if (!emailApiKey) {
      return new Response(JSON.stringify({ error: 'Email provider not configured' }), {
        status: 503,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const userEmail = userData.user.email;
    const htmlBody = markdownToSimpleHtml(markdown);
    const emailSubject = subject?.trim() || `Finova review pack — ${new Date().toLocaleDateString()}`;

    if (Deno.env.get('RESEND_API_KEY')) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${emailApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: userEmail,
          subject: emailSubject,
          html: htmlBody,
        }),
      });
      if (!res.ok) {
        return new Response(JSON.stringify({ error: await res.text() }), {
          status: 502,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    } else {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${emailApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: userEmail }] }],
          from: { email: emailFrom },
          subject: emailSubject,
          content: [{ type: 'text/html', value: htmlBody }],
        }),
      });
      if (!res.ok) {
        return new Response(JSON.stringify({ error: await res.text() }), {
          status: 502,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ message: 'Review pack sent', email: userEmail }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
