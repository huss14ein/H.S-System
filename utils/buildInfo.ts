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

/** Live SPA host (Vercel auto-deploys from main with finova-build-sha). */
export const CANONICAL_VITE_APP_URL = 'https://h-s-system.vercel.app';

/** Netlify host — serves `/api/*` functions only; SPA traffic redirects to {@link CANONICAL_VITE_APP_URL}. */
export const NETLIFY_API_ORIGIN = 'https://finova-hussein.netlify.app';

/** @deprecated Use {@link CANONICAL_VITE_APP_URL}. Kept for Settings copy. */
export const VERCEL_FALLBACK_APP_URL = CANONICAL_VITE_APP_URL;

/** Preferred production URL (env override → default Netlify). Set in netlify.toml / site env after linking this repo. */
export function getCanonicalAppUrl(): string {
  const fromEnv = import.meta.env.VITE_CANONICAL_APP_URL?.trim();
  const url = fromEnv || CANONICAL_VITE_APP_URL;
  return url.replace(/\/$/, '');
}

/** True when the SPA hostname matches canonical Vercel or Netlify API host. */
export function isOnCanonicalHost(): boolean {
  if (import.meta.env.DEV || typeof window === 'undefined') return true;
  try {
    const host = window.location.hostname.toLowerCase();
    const canonical = new URL(getCanonicalAppUrl()).hostname.toLowerCase();
    const netlify = new URL(NETLIFY_API_ORIGIN).hostname.toLowerCase();
    return host === canonical || host === netlify;
  } catch {
    return true;
  }
}
