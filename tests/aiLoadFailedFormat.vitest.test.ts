import { describe, expect, it } from 'vitest';
import { formatAiError } from '../services/geminiService';

describe('formatAiError network / Safari Load failed', () => {
  it('maps Safari TypeError Load failed to a friendly network message', () => {
    const msg = formatAiError(new TypeError('Load failed'));
    expect(msg).toMatch(/Could not reach the AI service/i);
    expect(msg).not.toMatch(/^AI Service Error: Load failed$/);
  });

  it('maps Failed to fetch to the same friendly network message', () => {
    const msg = formatAiError(new TypeError('Failed to fetch'));
    expect(msg).toMatch(/Could not reach the AI service/i);
  });
});
