import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout';
import ReactGridLayout from 'react-grid-layout/legacy';
import { getStoredLayout, setStoredLayout } from '../utils/layoutStorage';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const DEFAULT_COLS = 12;
const DEFAULT_ROW_HEIGHT = 80;
const DEFAULT_MARGIN: [number, number] = [16, 16];
const DEFAULT_W = 4;
const DEFAULT_H = 2;

export interface GridItemConfig {
  id: string;
  content: React.ReactNode;
  /** Default width in grid units */
  defaultW?: number;
  /** Default height in grid units */
  defaultH?: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface DraggableResizableGridProps {
  /** Unique key for this grid (e.g. page name). Used to persist layout in localStorage. */
  layoutKey: string;
  /** Items to render in the grid. Order is used only for initial layout if none is stored. */
  items: GridItemConfig[];
  /** Grid columns (default 12) */
  cols?: number;
  /** Row height in pixels (default 80) */
  rowHeight?: number;
  /** Margin between items [x, y] (default [16, 16]) */
  margin?: [number, number];
  /** Optional className for the grid container */
  className?: string;
  /** If true, items can be dragged (default true) */
  isDraggable?: boolean;
  /** If true, items can be resized (default true) */
  isResizable?: boolean;
  /** If true, resize handle is hidden until the user hovers over a grid item (no visible buttons) */
  handlesOnHoverOnly?: boolean;
  /** CSS selector for the drag handle element. If set, only that element starts a drag; clicking the rest of the item won't trigger drag (e.g. so card clicks can navigate). */
  draggableHandle?: string;
  /** Vertical overflow behavior for each grid item wrapper. Defaults to 'auto' (scrolls when content exceeds tile). */
  itemOverflowY?: 'auto' | 'visible' | 'hidden';
}

function buildDefaultLayout(items: GridItemConfig[], cols: number): Layout {
  const layout: LayoutItem[] = [];
  let x = 0;
  let y = 0;
  items.forEach((item) => {
    const w = item.defaultW ?? DEFAULT_W;
    const h = item.defaultH ?? DEFAULT_H;
    if (x + w > cols) {
      x = 0;
      y += h;
    }
    layout.push({
      i: item.id,
      x,
      y,
      w,
      h,
      minW: item.minW ?? 1,
      minH: item.minH ?? 1,
      maxW: item.maxW,
      maxH: item.maxH,
    });
    x += w;
  });
  return layout;
}

function mergeLayout(
  stored: Layout | null,
  items: GridItemConfig[],
  cols: number
): Layout {
  const ids = new Set(items.map((i) => i.id));
  const byId = new Map<string, LayoutItem>();
  if (stored && stored.length > 0) {
    stored.forEach((item) => {
      if (ids.has(item.i)) byId.set(item.i, { ...item });
    });
  }
  const defaultLayout = buildDefaultLayout(items, cols);
  defaultLayout.forEach((item) => {
    if (!byId.has(item.i)) byId.set(item.i, { ...item });
  });
  return Array.from(byId.values());
}

export const DraggableResizableGrid: React.FC<DraggableResizableGridProps> = ({
  layoutKey,
  items,
  cols = DEFAULT_COLS,
  rowHeight = DEFAULT_ROW_HEIGHT,
  margin = DEFAULT_MARGIN,
  className = '',
  isDraggable = true,
  isResizable = true,
  handlesOnHoverOnly = false,
  draggableHandle,
  itemOverflowY = 'auto',
}) => {
  const { width, containerRef, mounted } = useContainerWidth({
    measureBeforeMount: false,
    initialWidth: 1200,
  });

  const [layout, setLayout] = useState<Layout>(() => {
    const stored = getStoredLayout(layoutKey);
    return mergeLayout(stored, items, cols);
  });

  const itemIds = useMemo(() => items.map((i) => i.id).join(','), [items]);
  useEffect(() => {
    const stored = getStoredLayout(layoutKey);
    setLayout(mergeLayout(stored, items, cols));
  }, [layoutKey, itemIds, cols, items]);

  const contentById = useMemo(() => {
    const map = new Map<string, React.ReactNode>();
    items.forEach((item) => map.set(item.id, item.content));
    return map;
  }, [items]);

  const onLayoutChange = useCallback(
    (newLayout: Layout) => {
      setLayout(newLayout);
      setStoredLayout(layoutKey, newLayout);
    },
    [layoutKey]
  );

  const orderedLayout = useMemo(() => {
    const idOrder = items.map((i) => i.id);
    return [...layout].sort(
      (a, b) => idOrder.indexOf(a.i) - idOrder.indexOf(b.i)
    );
  }, [layout, items]);

  if (items.length === 0) return null;

  const containerClass = `rgl-container min-w-0 ${handlesOnHoverOnly ? 'rgl-handles-on-hover' : ''} ${className}`.trim();
  const itemOverflowClass =
    itemOverflowY === 'visible'
      ? 'overflow-y-visible'
      : itemOverflowY === 'hidden'
      ? 'overflow-y-hidden'
      : 'overflow-y-auto';
  return (
    <div ref={containerRef as React.RefObject<HTMLDivElement>} className={containerClass}>
      {mounted && width > 0 && (
        <ReactGridLayout
          layout={orderedLayout}
          onLayoutChange={onLayoutChange}
          width={width}
          cols={cols}
          rowHeight={rowHeight}
          margin={margin}
          containerPadding={margin}
          isDraggable={isDraggable}
          isResizable={isResizable}
          draggableHandle={draggableHandle}
          compactType="vertical"
          preventCollision={false}
          useCSSTransforms
          className="rgl-grid"
        >
          {orderedLayout.map((item) => (
            <div
              key={item.i}
              className={`rgl-item-wrapper min-h-0 ${itemOverflowClass} overflow-x-hidden`}
            >
              {contentById.get(item.i) ?? null}
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
};

export default DraggableResizableGrid;
