/** Injected at build time via vite.config.ts (Vercel / Netlify / GitHub env). */
declare const __APP_BUILD_SHA__: string;
declare const __APP_BUILD_TIME__: string;
declare const __WEALTH_ANALYTICS_V2__: boolean;

export const APP_VERSION = '2.1.1.0';

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

/** Where the Vite H.S-System app is deployed (not my-finova.netlify.app — that is a separate Next.js app). */
export const CANONICAL_VITE_APP_URL = 'https://h-s-system.vercel.app';
