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

/** Default production URL when VITE_CANONICAL_APP_URL is unset. */
export const CANONICAL_VITE_APP_URL = 'https://finova-hussein.netlify.app';

/** Vercel mirror — serves the SPA when Netlify canonical is unavailable; /api/* proxies to Netlify. */
export const VERCEL_FALLBACK_APP_URL = 'https://h-s-system.vercel.app';

/** Preferred production URL (env override → default Netlify). Set in netlify.toml / site env after linking this repo. */
export function getCanonicalAppUrl(): string {
  const fromEnv = import.meta.env.VITE_CANONICAL_APP_URL?.trim();
  const url = fromEnv || CANONICAL_VITE_APP_URL;
  return url.replace(/\/$/, '');
}

/** True when the SPA hostname matches the configured canonical production host. */
export function isOnCanonicalHost(): boolean {
  if (import.meta.env.DEV || typeof window === 'undefined') return true;
  try {
    return window.location.hostname === new URL(getCanonicalAppUrl()).hostname;
  } catch {
    return true;
  }
}
