import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isOriginAllowed, deployedAllowedOrigins } from '../netlify/functions/corsAllowlist';

describe('corsAllowlist', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.URL;
    delete process.env.DEPLOY_PRIME_URL;
    delete process.env.NETLIFY_SITE_URL;
    delete process.env.DEPLOY_URL;
    delete process.env.NETLIFY_SITE_NAME;
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('allows localhost and 127.0.0.1 with ports', () => {
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:8888')).toBe(true);
    expect(isOriginAllowed('https://localhost')).toBe(true);
  });

  it('respects ALLOWED_ORIGINS when set', () => {
    process.env.ALLOWED_ORIGINS = 'https://app.example.test, https://staging.example.test';
    // Re-evaluate closure: deployedAllowedOrigins reads env at call time in current impl
    expect(deployedAllowedOrigins().has('https://app.example.test')).toBe(true);
    expect(deployedAllowedOrigins().has('https://staging.example.test')).toBe(true);
    expect(isOriginAllowed('https://app.example.test')).toBe(true);
    expect(isOriginAllowed('https://evil.test')).toBe(false);
  });

  it('respects NETLIFY_SITE_URL origin', () => {
    process.env.NETLIFY_SITE_URL = 'https://my-finova.netlify.app';
    expect(isOriginAllowed('https://my-finova.netlify.app')).toBe(true);
    expect(isOriginAllowed('https://evil.netlify.app')).toBe(false);
  });

  it('respects DEPLOY_URL origin (deploy permalink / preview)', () => {
    process.env.DEPLOY_URL = 'https://abc123--my-finova.netlify.app';
    expect(isOriginAllowed('https://abc123--my-finova.netlify.app')).toBe(true);
    // Same site slug as DEPLOY_URL → deploy previews all match (deploy id prefix may vary).
    expect(isOriginAllowed('https://other--my-finova.netlify.app')).toBe(true);
    expect(isOriginAllowed('https://not-my-finova.netlify.app')).toBe(false);
  });

  it('allows deploy-preview origins for the same site without listing each preview in ALLOWED_ORIGINS', () => {
    process.env.URL = 'https://my-finova.netlify.app';
    expect(isOriginAllowed('https://6a00b4efa46d9e000858a724--my-finova.netlify.app')).toBe(true);
    expect(isOriginAllowed('https://deadbeef--my-finova.netlify.app')).toBe(true);
  });

  it('does not allow *.netlify.app deploy URLs for a different site slug', () => {
    process.env.URL = 'https://my-finova.netlify.app';
    expect(isOriginAllowed('https://abc123--other-site.netlify.app')).toBe(false);
  });

  it('strips surrounding quotes from ALLOWED_ORIGINS tokens', () => {
    process.env.ALLOWED_ORIGINS = '"https://quoted.example.test", \'https://single.example.test\'';
    expect(isOriginAllowed('https://quoted.example.test')).toBe(true);
    expect(isOriginAllowed('https://single.example.test')).toBe(true);
  });

  it('allows typical RFC1918 LAN origins for local network dev', () => {
    expect(isOriginAllowed('http://192.168.1.42:5173')).toBe(true);
    expect(isOriginAllowed('http://10.0.0.5:8888')).toBe(true);
    expect(isOriginAllowed('http://172.20.1.1:3000')).toBe(true);
  });

  it('allows mDNS .local and Tailscale CGNAT-style hosts', () => {
    expect(isOriginAllowed('http://my-mac.local:5173')).toBe(true);
    expect(isOriginAllowed('http://100.100.45.12:5173')).toBe(true);
    expect(isOriginAllowed('http://100.50.1.2:5173')).toBe(false);
  });

  it('respects Vercel deployment URLs and canonical app URL', () => {
    process.env.VERCEL_URL = 'h-s-system.vercel.app';
    expect(isOriginAllowed('https://h-s-system.vercel.app')).toBe(true);
    process.env.VITE_CANONICAL_APP_URL = 'https://app.example.test';
    expect(isOriginAllowed('https://app.example.test')).toBe(true);
    expect(isOriginAllowed('https://other.vercel.app')).toBe(false);
  });

  it('respects FINOVA_CANONICAL_APP_URL on functions runtime', () => {
    process.env.FINOVA_CANONICAL_APP_URL = 'https://finova-hussein.netlify.app';
    expect(isOriginAllowed('https://finova-hussein.netlify.app')).toBe(true);
    expect(isOriginAllowed('https://other.netlify.app')).toBe(false);
  });
});
