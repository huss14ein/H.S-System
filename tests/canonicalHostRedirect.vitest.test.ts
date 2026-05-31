import { describe, expect, it } from 'vitest';
import { isLocalDevHost, shouldRedirectToCanonicalHost } from '../utils/canonicalHostRedirect';

describe('canonicalHostRedirect', () => {
  it('detects local dev hosts', () => {
    expect(isLocalDevHost('localhost')).toBe(true);
    expect(isLocalDevHost('127.0.0.1')).toBe(true);
    expect(isLocalDevHost('192.168.1.5')).toBe(true);
    expect(isLocalDevHost('h-s-system.vercel.app')).toBe(false);
  });

  it('redirects netlify deploy hosts to canonical', () => {
    expect(
      shouldRedirectToCanonicalHost('6a10e281--fancy-belekoy-8a5dff.netlify.app', 'h-s-system.vercel.app'),
    ).toBe(true);
    expect(shouldRedirectToCanonicalHost('h-s-system.vercel.app', 'h-s-system.vercel.app')).toBe(false);
    expect(shouldRedirectToCanonicalHost('localhost', 'h-s-system.vercel.app')).toBe(false);
  });
});
