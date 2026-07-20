/**
 * Turn unknown thrown values (Error, Postgrest/Supabase objects, strings) into a readable message.
 * Avoids UI showing the useless "[object Object]".
 */
export function formatUnknownError(error: unknown, fallback = 'Something went wrong.'): string {
  if (error == null) return fallback;
  if (typeof error === 'string') {
    const t = error.trim();
    return t && t !== '[object Object]' ? t : fallback;
  }
  if (error instanceof Error) {
    const msg = String(error.message ?? '').trim();
    if (msg && msg !== '[object Object]') return msg;
  }
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const parts: string[] = [];
    const push = (v: unknown) => {
      if (v == null) return;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t && t !== '[object Object]') parts.push(t);
        return;
      }
      if (typeof v === 'number' || typeof v === 'boolean') {
        parts.push(String(v));
        return;
      }
      if (typeof v === 'object') {
        try {
          const json = JSON.stringify(v);
          if (json && json !== '{}' && json !== 'null') parts.push(json);
        } catch {
          /* ignore */
        }
      }
    };
    push(obj.message);
    push(obj.details);
    push(obj.hint);
    push(obj.code);
    push(obj.error);
    if (parts.length > 0) return parts.join(' | ');
    try {
      const json = JSON.stringify(obj);
      if (json && json !== '{}' && json !== '[object Object]') return json;
    } catch {
      /* ignore */
    }
  }
  const coerced = String(error);
  return coerced && coerced !== '[object Object]' ? coerced : fallback;
}
