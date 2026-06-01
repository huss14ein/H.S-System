import { CANONICAL_VITE_APP_URL, getCanonicalAppUrl } from './buildInfo';

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
const LAN_HOST_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Hostnames that should never be redirected (local dev). */
export function isLocalDevHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (LOCAL_HOST_RE.test(h)) return true;
  if (LAN_HOST_RE.test(h)) return true;
  if (h.endsWith('.local')) return true;
  return false;
}

/** True when the browser should load the canonical production app (not a stale Netlify preview). */
export function shouldRedirectToCanonicalHost(hostname: string, canonicalHostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  const canonical = canonicalHostname.trim().toLowerCase();
  if (!host || !canonical || host === canonical) return false;
  if (isLocalDevHost(host)) return false;
  // Stale deploy previews (Netlify permalinks) and old Vercel URLs → canonical production host.
  if (host.endsWith('.netlify.app')) return true;
  if (host.endsWith('.vercel.app')) return true;
  return false;
}

/**
 * Redirect stale deploy hosts to the canonical production app before React boots.
 * Preserves path, query, and hash so deep links survive.
 */
export function enforceCanonicalHostRedirect(): void {
  if (typeof window === 'undefined') return;
  if (import.meta.env.DEV) return;
  const canonicalUrl = getCanonicalAppUrl() || CANONICAL_VITE_APP_URL;
  let canonicalHost: string;
  try {
    canonicalHost = new URL(canonicalUrl).hostname;
  } catch {
    return;
  }
  const { hostname, pathname, search, hash } = window.location;
  if (!shouldRedirectToCanonicalHost(hostname, canonicalHost)) return;
  const target = `${canonicalUrl.replace(/\/$/, '')}${pathname}${search}${hash}`;
  window.location.replace(target);
}
