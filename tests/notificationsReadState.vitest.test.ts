/**
 * Alerts bell read/dismiss state — merge on mark-all, per-row dismiss wiring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('notifications read state', () => {
  it('markAllAsRead merges into existing readIds instead of replacing', () => {
    const src = read('context/NotificationsContext.tsx');
    expect(src).toMatch(/setReadIds\(\(prev\) => new Set\(\[\.\.\.prev, \.\.\.notifications\.map/);
    expect(src).not.toMatch(/setReadIds\(\(\) => new Set\(notifications\.map/);
  });

  it('mark-all sets dismiss grace for enhancement signals', () => {
    const src = read('context/NotificationsContext.tsx');
    expect(src).toContain('dismissGraceUntilRef');
    expect(src).toContain('inDismissGrace');
    expect(src).toMatch(/dismissGraceUntilRef\.current = Date\.now\(\) \+ 30_000/);
  });

  it('header popover supports per-row dismiss without navigation', () => {
    const src = read('components/HeaderAlertsPopover.tsx');
    expect(src).toContain('markAsRead(n.id)');
    expect(src).toContain('Mark as read');
    expect(src).toContain('onOpenNotification(n)');
  });
});
