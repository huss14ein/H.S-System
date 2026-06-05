import { describe, expect, it } from 'vitest';
import {
  isLighthouseAuditUserAgent,
  isLocalDevHost,
  shouldRedirectToCanonicalHost,
} from '../utils/canonicalHostRedirect';

describe('canonicalHostRedirect', () => {
  it('detects local dev hosts', () => {
    expect(isLocalDevHost('localhost')).toBe(true);
    expect(isLocalDevHost('127.0.0.1')).toBe(true);
    expect(isLocalDevHost('192.168.1.5')).toBe(true);
    expect(isLocalDevHost('finova-hussein.netlify.app')).toBe(false);
  });

  it('redirects stale deploy hosts to canonical Netlify production', () => {
    const canonical = 'finova-hussein.netlify.app';
    expect(
      shouldRedirectToCanonicalHost('6a10e281--fancy-belekoy-8a5dff.netlify.app', canonical),
    ).toBe(true);
    expect(
      shouldRedirectToCanonicalHost('6a232b93--finova-hussein.netlify.app', canonical),
    ).toBe(true);
    expect(
      shouldRedirectToCanonicalHost('6a1df5bbbf791a00088d929c.netlify.app', canonical),
    ).toBe(false);
    expect(shouldRedirectToCanonicalHost('finova-hussein.netlify.app', canonical)).toBe(false);
    expect(shouldRedirectToCanonicalHost('h-s-system.vercel.app', canonical)).toBe(false);
    expect(shouldRedirectToCanonicalHost('localhost', canonical)).toBe(false);
  });

  it('does not redirect Netlify deploy previews during Lighthouse audits', () => {
    const canonical = 'finova-hussein.netlify.app';
    const preview = '6a232b93--finova-hussein.netlify.app';
    const lighthouseUa =
      'Mozilla/5.0 (Linux; Android 7.0; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4695.0 Mobile Safari/537.36 Chrome-Lighthouse';
    expect(isLighthouseAuditUserAgent(lighthouseUa)).toBe(true);
    expect(shouldRedirectToCanonicalHost(preview, canonical, lighthouseUa)).toBe(false);
    expect(shouldRedirectToCanonicalHost(preview, canonical, 'Mozilla/5.0 Safari')).toBe(true);
  });
});
