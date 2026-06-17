/** Allow only http(s) links in user-facing anchors (blocks javascript:, data:, etc.). */
export function isSafeExternalUrl(href: string | null | undefined): boolean {
  if (!href || typeof href !== 'string') return false;
  const trimmed = href.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function safeExternalHref(href: string | null | undefined): string | null {
  return isSafeExternalUrl(href) ? String(href).trim() : null;
}
