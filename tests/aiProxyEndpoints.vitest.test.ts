import { describe, expect, it } from 'vitest';
import { getGeminiProxyEndpoints } from '../services/aiProxyEndpoints';

describe('getGeminiProxyEndpoints', () => {
  it('prefers same-host /api path first', () => {
    const endpoints = getGeminiProxyEndpoints();
    expect(endpoints[0]).toBe('/api/gemini-proxy');
    expect(endpoints).not.toContain('/.netlify/functions/gemini-proxy');
  });
});
