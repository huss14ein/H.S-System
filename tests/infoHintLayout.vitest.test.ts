import { describe, expect, it } from 'vitest';
import { computeInfoHintPanelStyle } from '../utils/infoHintLayout';

describe('computeInfoHintPanelStyle', () => {
  it('auto placement opens above when there is no room below', () => {
    const style = computeInfoHintPanelStyle({
      triggerRect: {
        top: 760,
        bottom: 780,
        left: 200,
        right: 220,
        width: 20,
        height: 20,
      },
      viewportWidth: 1024,
      viewportHeight: 800,
      placement: 'auto',
      popoverAlign: 'left',
    });

    expect(style.top).toBe(532);
    expect(Number(style.top)).toBeLessThan(760);
  });

  it('auto placement opens below when there is enough room below', () => {
    const style = computeInfoHintPanelStyle({
      triggerRect: {
        top: 100,
        bottom: 120,
        left: 200,
        right: 220,
        width: 20,
        height: 20,
      },
      viewportWidth: 1024,
      viewportHeight: 800,
      placement: 'auto',
      popoverAlign: 'left',
    });

    expect(style.top).toBe(128);
  });

  it('clamps panel width on narrow mobile viewport', () => {
    const style = computeInfoHintPanelStyle({
      triggerRect: {
        top: 100,
        bottom: 120,
        left: 4,
        right: 24,
        width: 20,
        height: 20,
      },
      viewportWidth: 300,
      viewportHeight: 700,
      placement: 'bottom',
      popoverAlign: 'left',
    });

    expect(style.width).toBe(284);
    expect(style.left).toBe(8);
  });

  it('right alignment keeps panel inside viewport', () => {
    const style = computeInfoHintPanelStyle({
      triggerRect: {
        top: 220,
        bottom: 240,
        left: 780,
        right: 800,
        width: 20,
        height: 20,
      },
      viewportWidth: 820,
      viewportHeight: 900,
      placement: 'bottom',
      popoverAlign: 'right',
    });

    expect(style.left).toBeGreaterThanOrEqual(8);
    expect(style.left).toBeLessThanOrEqual(820 - Number(style.width) - 8);
  });
});
