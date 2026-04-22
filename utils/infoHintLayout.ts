export type InfoHintPlacement = 'auto' | 'top' | 'bottom';
export type InfoHintPopoverAlign = 'left' | 'right';

export interface InfoHintRectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ComputeInfoHintLayoutInput {
  triggerRect: InfoHintRectLike;
  viewportWidth: number;
  viewportHeight: number;
  panelWidth: number;
  panelHeight: number;
  placement: InfoHintPlacement;
  popoverAlign: InfoHintPopoverAlign;
  gap: number;
}

export interface ComputeInfoHintLayoutResult {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  actualPlacement: 'top' | 'bottom';
}

export interface ComputeInfoHintPanelStyleInput {
  triggerRect: InfoHintRectLike;
  viewportWidth: number;
  viewportHeight: number;
  placement: InfoHintPlacement;
  popoverAlign: InfoHintPopoverAlign;
  panelWidth?: number;
  panelHeight?: number;
  gap?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

/**
 * Compute a viewport-safe popover box for InfoHint.
 * Auto placement prefers "bottom" when it has enough room; otherwise flips to "top".
 */
export function computeInfoHintLayout(input: ComputeInfoHintLayoutInput): ComputeInfoHintLayoutResult {
  const {
    triggerRect,
    viewportWidth,
    viewportHeight,
    panelWidth,
    panelHeight,
    placement,
    popoverAlign,
    gap,
  } = input;

  const safeViewportW = Math.max(0, viewportWidth);
  const safeViewportH = Math.max(0, viewportHeight);
  const maxUsableWidth = Math.max(120, safeViewportW - gap * 2);
  const width = clamp(panelWidth, 120, maxUsableWidth);
  const estimatedPanelHeight = Number.isFinite(panelHeight) && panelHeight > 0 ? panelHeight : 220;

  let left = popoverAlign === 'right' ? triggerRect.right - width : triggerRect.left;
  left = clamp(left, gap, Math.max(gap, safeViewportW - width - gap));

  const spaceBelow = Math.max(0, safeViewportH - triggerRect.bottom - gap);
  const spaceAbove = Math.max(0, triggerRect.top - gap);

  let actualPlacement: 'top' | 'bottom';
  if (placement === 'top') {
    actualPlacement = 'top';
  } else if (placement === 'bottom') {
    actualPlacement = 'bottom';
  } else {
    const enoughBelow = spaceBelow >= Math.min(estimatedPanelHeight, 220);
    actualPlacement = enoughBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top';
  }

  if (actualPlacement === 'bottom') {
    let top = triggerRect.bottom + gap;
    const maxTop = safeViewportH - estimatedPanelHeight - gap;
    if (Number.isFinite(maxTop)) top = Math.min(top, maxTop);
    top = clamp(top, gap, Math.max(gap, safeViewportH - gap));
    const available = Math.max(80, safeViewportH - top - gap);
    return { left, top, width, maxHeight: available, actualPlacement };
  }

  let top = triggerRect.top - estimatedPanelHeight - gap;
  top = Math.max(gap, top);
  top = Math.min(top, Math.max(gap, safeViewportH - gap - 80));
  const available = Math.max(80, triggerRect.top - gap * 2);
  return { left, top, width, maxHeight: available, actualPlacement };
}

export function computeInfoHintPanelStyle(input: ComputeInfoHintPanelStyleInput): Record<string, string | number> {
  const {
    triggerRect,
    viewportWidth,
    viewportHeight,
    placement,
    popoverAlign,
    panelWidth = 320,
    panelHeight = 220,
    gap = 8,
  } = input;
  const layout = computeInfoHintLayout({
    triggerRect,
    viewportWidth,
    viewportHeight,
    panelWidth,
    panelHeight,
    placement,
    popoverAlign,
    gap,
  });
  return {
    position: 'fixed',
    left: layout.left,
    top: layout.top,
    width: layout.width,
    maxHeight: layout.maxHeight,
  };
}
