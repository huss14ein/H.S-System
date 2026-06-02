import { describe, expect, it } from 'vitest';
import { isLocalDevHost, shouldRedirectToCanonicalHost } from '../utils/canonicalHostRedirect';

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
      shouldRedirectToCanonicalHost('6a1df5bbbf791a00088d929c.netlify.app', canonical),
    ).toBe(false);
    expect(shouldRedirectToCanonicalHost('finova-hussein.netlify.app', canonical)).toBe(false);
    expect(shouldRedirectToCanonicalHost('h-s-system.vercel.app', canonical)).toBe(false);
    expect(shouldRedirectToCanonicalHost('localhost', canonical)).toBe(false);
  });
});
