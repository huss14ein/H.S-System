/** Injected at build time via vite.config.ts (Vercel / Netlify / GitHub env). */
declare const __APP_BUILD_SHA__: string;
declare const __APP_BUILD_TIME__: string;
declare const __WEALTH_ANALYTICS_V2__: boolean;

export const APP_VERSION = '2.5.0.0';

/** Short git sha baked into the production bundle — use Settings → About build to verify deploy. */
export function getBuildSha(): string {
  try {
    return typeof __APP_BUILD_SHA__ !== 'undefined' && __APP_BUILD_SHA__ ? __APP_BUILD_SHA__ : 'dev';
  } catch {
    return 'dev';
  }
}

export function getBuildTimeIso(): string {
  try {
    return typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : '';
  } catch {
    return '';
  }
}

/** True when this bundle includes Wealth Analytics v2 layout (baked in at build). */
export function hasWealthAnalyticsRollout(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return typeof __WEALTH_ANALYTICS_V2__ !== 'undefined' && __WEALTH_ANALYTICS_V2__ === true;
  } catch {
    return false;
  }
}

/** Production SPA — Vercel auto-deploys from main (no extra GitHub secrets). */
export const CANONICAL_VITE_APP_URL = 'https://h-s-system.vercel.app';

/** Netlify host — `/api/*` functions + redirect to Vercel SPA for bookmarks. */
export const NETLIFY_PRODUCTION_ORIGIN = 'https://finova-hussein.netlify.app';

/** @deprecated Use {@link NETLIFY_PRODUCTION_ORIGIN}. */
export const NETLIFY_API_ORIGIN = NETLIFY_PRODUCTION_ORIGIN;

/** Vercel mirror — proxies `/api/*` to Netlify; optional secondary host. */
export const VERCEL_MIRROR_APP_URL = 'https://h-s-system.vercel.app';

/** @deprecated Use {@link VERCEL_MIRROR_APP_URL}. */
export const VERCEL_FALLBACK_APP_URL = VERCEL_MIRROR_APP_URL;

/** Preferred production URL (env override → default Netlify). Set in netlify.toml / site env after linking this repo. */
export function getCanonicalAppUrl(): string {
  const fromEnv = import.meta.env.VITE_CANONICAL_APP_URL?.trim();
  const url = fromEnv || CANONICAL_VITE_APP_URL;
  return url.replace(/\/$/, '');
}

/** True when the SPA hostname matches canonical Vercel, Netlify bookmark, or env override. */
export function isOnCanonicalHost(): boolean {
  if (import.meta.env.DEV || typeof window === 'undefined') return true;
  try {
    const host = window.location.hostname.toLowerCase();
    const canonical = new URL(getCanonicalAppUrl()).hostname.toLowerCase();
    const netlify = new URL(NETLIFY_PRODUCTION_ORIGIN).hostname.toLowerCase();
    return host === canonical || host === netlify;
  } catch {
    return true;
  }
}
