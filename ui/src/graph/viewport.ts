import type { GraphViewport, Position } from '../types.js';

export interface ViewportSize { width: number; height: number }
export interface NodeSize { width: number; height: number }
export interface PositionedNode { id: string; x: number; y: number }

const minScale = 0.35;
const maxScale = 2.5;

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(maxScale, Math.max(minScale, value));
}

export function resetViewport(): GraphViewport { return { x: 0, y: 0, scale: 1 }; }

export function panViewport(viewport: GraphViewport, dx: number, dy: number): GraphViewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

export function resizeViewport(viewport: GraphViewport, previous: ViewportSize, next: ViewportSize): GraphViewport {
  if (previous.width <= 0 || previous.height <= 0 || next.width <= 0 || next.height <= 0) return viewport;
  return {
    ...viewport,
    x: viewport.x + (next.width - previous.width) / 2,
    y: viewport.y + (next.height - previous.height) / 2,
  };
}

export function screenToWorld(viewport: GraphViewport, point: Position): Position {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function zoomViewportAt(viewport: GraphViewport, requestedScale: number, anchor: Position): GraphViewport {
  const scale = clampScale(requestedScale);
  const world = screenToWorld(viewport, anchor);
  return {
    scale,
    x: anchor.x - world.x * scale,
    y: anchor.y - world.y * scale,
  };
}

export function fitViewport(
  nodes: PositionedNode[],
  viewport: ViewportSize,
  node: NodeSize = { width: 190, height: 108 },
  padding = 56,
): GraphViewport {
  if (nodes.length === 0 || viewport.width <= 0 || viewport.height <= 0) return resetViewport();
  const minX = Math.min(...nodes.map((item) => item.x));
  const minY = Math.min(...nodes.map((item) => item.y));
  const maxX = Math.max(...nodes.map((item) => item.x + node.width));
  const maxY = Math.max(...nodes.map((item) => item.y + node.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const scale = clampScale(Math.min(availableWidth / width, availableHeight / height));
  return {
    scale,
    x: (viewport.width - width * scale) / 2 - minX * scale,
    y: (viewport.height - height * scale) / 2 - minY * scale,
  };
}
