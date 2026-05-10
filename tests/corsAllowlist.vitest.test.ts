import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isOriginAllowed, deployedAllowedOrigins } from '../netlify/functions/corsAllowlist';

describe('corsAllowlist', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.URL;
    delete process.env.DEPLOY_PRIME_URL;
    delete process.env.NETLIFY_SITE_URL;
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

  it('allows typical RFC1918 LAN origins for local network dev', () => {
    expect(isOriginAllowed('http://192.168.1.42:5173')).toBe(true);
    expect(isOriginAllowed('http://10.0.0.5:8888')).toBe(true);
    expect(isOriginAllowed('http://172.20.1.1:3000')).toBe(true);
  });
});
