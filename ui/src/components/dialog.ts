import { escapeHtml } from '../dom.js';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'dialog-card';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'confirm-dialog-title');

    const isDanger = options.variant === 'danger';
    const confirmClass = isDanger ? 'danger-button icon-button' : 'primary-button icon-button';
    const confirmLabel = options.confirmText ?? (isDanger ? 'Delete' : 'Confirm');
    const cancelLabel = options.cancelText ?? 'Cancel';

    const confirmIcon = isDanger
      ? '<svg class="button-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M4 4.5l.7 8.4a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
      : '';

    dialog.innerHTML = `
      <div class="dialog-header">
        <div class="dialog-icon-wrapper ${isDanger ? 'danger' : ''}">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 3v4.5M8 11.5h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </div>
        <h3 id="confirm-dialog-title" class="dialog-title">${escapeHtml(options.title)}</h3>
      </div>
      <div class="dialog-body">
        <p>${escapeHtml(options.message)}</p>
      </div>
      <div class="dialog-footer">
        <button type="button" class="secondary-button dialog-cancel">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="${confirmClass} dialog-confirm">${confirmIcon}<span>${escapeHtml(confirmLabel)}</span></button>
      </div>
    `;

    backdrop.append(dialog);
    document.body.append(backdrop);

    const cancelButton = dialog.querySelector<HTMLButtonElement>('.dialog-cancel')!;
    const confirmButton = dialog.querySelector<HTMLButtonElement>('.dialog-confirm')!;

    let done = false;
    function cleanup(result: boolean): void {
      if (done) return;
      done = true;
      backdrop.classList.add('closing');
      setTimeout(() => {
        backdrop.remove();
        document.removeEventListener('keydown', onKeyDown);
        previousFocus?.focus?.();
        resolve(result);
      }, 120);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        cleanup(true);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const focusables = [cancelButton, confirmButton];
        const current = focusables.indexOf(document.activeElement as HTMLButtonElement);
        focusables[(current + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length]?.focus();
      }
    }

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) cleanup(false);
    });

    cancelButton.addEventListener('click', () => cleanup(false));
    confirmButton.addEventListener('click', () => cleanup(true));

    document.addEventListener('keydown', onKeyDown);
    confirmButton.focus();
  });
}

export interface PromptDialogOptions {
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}

export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'dialog-card';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', options.title);

    const confirmLabel = options.confirmText ?? 'Create';
    const cancelLabel = options.cancelText ?? 'Cancel';
    const defaultValue = options.defaultValue ?? '';
    const placeholder = options.placeholder ?? '';

    dialog.innerHTML = `
      <div class="dialog-header">
        <div class="dialog-icon-wrapper">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </div>
        <h3 class="dialog-title">${escapeHtml(options.title)}</h3>
      </div>
      <div class="dialog-body">
        <p style="margin-bottom: 12px;">${escapeHtml(options.message)}</p>
        <input type="text" class="input dialog-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}">
      </div>
      <div class="dialog-footer">
        <button type="button" class="secondary-button dialog-cancel">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="primary-button dialog-confirm"><span>${escapeHtml(confirmLabel)}</span></button>
      </div>
    `;

    backdrop.append(dialog);
    document.body.append(backdrop);

    const input = dialog.querySelector<HTMLInputElement>('.dialog-input')!;
    const cancelButton = dialog.querySelector<HTMLButtonElement>('.dialog-cancel')!;
    const confirmButton = dialog.querySelector<HTMLButtonElement>('.dialog-confirm')!;

    let done = false;
    function cleanup(result: string | null): void {
      if (done) return;
      done = true;
      backdrop.classList.add('closing');
      setTimeout(() => {
        backdrop.remove();
        document.removeEventListener('keydown', onKeyDown);
        resolve(result);
      }, 120);
    }

    function submit(): void {
      const val = input.value.trim();
      cleanup(val ? val : null);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(null);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    }

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) cleanup(null);
    });

    cancelButton.addEventListener('click', () => cleanup(null));
    confirmButton.addEventListener('click', submit);

    document.addEventListener('keydown', onKeyDown);
    input.focus();
    input.select();
  });
}
