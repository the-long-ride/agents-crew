import { escapeHtml } from '../dom.js';

export interface TooltipConfig {
  text: string;
  position?: TooltipPosition;
}

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export function tooltipMarkup(text: string, position: TooltipPosition = 'top'): string {
  return ` data-tooltip="${escapeHtml(text)}" data-tooltip-position="${position}"`;
}

interface TooltipHandler {
  target: HTMLElement;
  enter: (e: Event) => void;
  leave: (e: Event) => void;
  blur: (e: Event) => void;
}

let tip: HTMLDivElement | null = null;
const handlers: TooltipHandler[] = [];
let observer: MutationObserver | undefined;

function ensureTip(): HTMLDivElement {
  if (tip && tip.isConnected) return tip;
  tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  return tip;
}

function showTip(target: HTMLElement): void {
  const text = target.dataset.tooltip;
  if (!text) return;
  const el = ensureTip();
  el.textContent = text;
  el.hidden = false;
  el.id = 'app-tooltip';
  positionTip(target);
  target.setAttribute('aria-describedby', 'app-tooltip');
}

function positionTip(target: HTMLElement): void {
  if (!tip || tip.hidden) return;
  const pos = (target.dataset.tooltipPosition ?? 'top') as TooltipPosition;
  const rect = target.getBoundingClientRect();
  const margin = 8;
  const tipRect = tip.getBoundingClientRect();
  let left: number;
  let top: number;
  if (pos === 'top') {
    left = rect.left + rect.width / 2 - tipRect.width / 2;
    top = rect.top - tipRect.height - margin;
  } else if (pos === 'bottom') {
    left = rect.left + rect.width / 2 - tipRect.width / 2;
    top = rect.bottom + margin;
  } else if (pos === 'left') {
    left = rect.left - tipRect.width - margin;
    top = rect.top + rect.height / 2 - tipRect.height / 2;
  } else {
    left = rect.right + margin;
    top = rect.top + rect.height / 2 - tipRect.height / 2;
  }
  left = Math.max(margin, Math.min(window.innerWidth - tipRect.width - margin, left));
  top = Math.max(margin, Math.min(window.innerHeight - tipRect.height - margin, top));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTip(target: HTMLElement): void {
  if (target) target.removeAttribute('aria-describedby');
  if (!tip) return;
  tip.hidden = true;
}

function bind(target: HTMLElement): void {
  const enter = (): void => showTip(target);
  const leave = (): void => hideTip(target);
  target.addEventListener('mouseenter', enter);
  target.addEventListener('mouseleave', leave);
  target.addEventListener('focusin', enter);
  target.addEventListener('focusout', leave);
  handlers.push({ target, enter, leave, blur: leave });
}

function isBound(target: HTMLElement): boolean {
  return handlers.some((h) => h.target === target);
}

function scan(node: ParentNode): void {
  for (const el of node.querySelectorAll<HTMLElement>('[data-tooltip]')) {
    if (!isBound(el) && el.isConnected) bind(el);
  }
}

function pruneDetached(): void {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (!handlers[i].target.isConnected) {
      const { target, enter, leave, blur } = handlers[i];
      target.removeEventListener('mouseenter', enter);
      target.removeEventListener('mouseleave', leave);
      target.removeEventListener('focusin', enter);
      target.removeEventListener('focusout', blur);
      handlers.splice(i, 1);
    }
  }
}

export function rescanTooltips(): void {
  pruneDetached();
  scan(document);
}

export function mountTooltips(root: Document | HTMLElement = document): () => void {
  scan(root);

  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.hasAttribute('data-tooltip') && !isBound(node) && node.isConnected) bind(node);
            scan(node);
          }
        }
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  return () => {
    for (const { target, enter, leave, blur } of handlers) {
      target.removeEventListener('mouseenter', enter);
      target.removeEventListener('mouseleave', leave);
      target.removeEventListener('focusin', enter);
      target.removeEventListener('focusout', blur);
    }
    handlers.length = 0;
    observer?.disconnect();
    observer = undefined;
    tip?.remove();
    tip = null;
  };
}
