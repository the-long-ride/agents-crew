import { escapeHtml } from '../dom.js';

export function infoButtonMarkup(title: string, description: string): string {
  return `<button type="button" class="info-button" aria-label="About ${escapeHtml(title)}" data-info-title="${escapeHtml(title)}" data-info-text="${escapeHtml(description)}">i</button>`;
}

export function mountInfoPopovers(root: Document = document): () => void {
  const popover = root.createElement('aside');
  popover.className = 'info-popover';
  popover.setAttribute('role', 'dialog');
  popover.hidden = true;
  root.body.append(popover);
  let trigger: HTMLElement | null = null;

  function close(): void {
    popover.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger = null;
  }

  function open(button: HTMLElement): void {
    if (trigger === button && !popover.hidden) { close(); return; }
    trigger?.setAttribute('aria-expanded', 'false');
    trigger = button;
    button.setAttribute('aria-expanded', 'true');
    popover.innerHTML = `<strong>${escapeHtml(button.dataset.infoTitle)}</strong><p>${escapeHtml(button.dataset.infoText)}</p>`;
    popover.hidden = false;
    const rect = button.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - 292, rect.right - 280));
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.min(window.innerHeight - 170, rect.bottom + 8)}px`;
  }

  const onClick = (event: MouseEvent): void => {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-info-title]');
    if (button) { event.preventDefault(); open(button); return; }
    if (!popover.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close(); };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  return () => { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); popover.remove(); };
}
