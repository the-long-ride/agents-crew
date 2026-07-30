export type SidebarSide = 'left' | 'right';

const minSidebarWidth = 200;
const maxSidebarWidth = 500;

export function resizeSidebarWidth(startWidth: number, pointerDelta: number, side: SidebarSide): number {
  const direction = side === 'left' ? 1 : -1;
  return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, Math.round(startWidth + pointerDelta * direction)));
}

export function mountSidebarResizers(builder: HTMLElement): void {
  for (const handle of builder.querySelectorAll<HTMLElement>('[data-sidebar-resizer]')) {
    const side = handle.dataset.sidebarResizer as SidebarSide;
    const panel = builder.querySelector<HTMLElement>(side === 'left' ? '.crew-panel' : '.inspector-panel');
    if (!panel) continue;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = panel.getBoundingClientRect().width;
      const property = side === 'left' ? '--left-sidebar-width' : '--right-sidebar-width';
      const move = (next: PointerEvent): void => {
        const width = resizeSidebarWidth(startWidth, next.clientX - startX, side);
        builder.style.setProperty(property, `${width}px`);
        handle.setAttribute('aria-valuenow', String(width));
      };
      const end = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }
}
