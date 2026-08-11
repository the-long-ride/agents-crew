import { escapeHtml } from '../dom.js';
import { comboCheckIcon, comboChevronIcon } from './icons.js';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string[];
}

export interface ComboboxConfig {
  id: string;
  value: string;
  options: ComboboxOption[];
  placeholder?: string;
  allowCustom?: boolean;
  searchable?: boolean;
  displayLabel?: boolean;
  emptyText?: string;
  onChange?: (value: string, option?: ComboboxOption) => void;
}

export interface ComboboxController {
  setOptions(options: ComboboxOption[], emptyText?: string): void;
  setValue(value: string): void;
  focus(): void;
  destroy(): void;
}

export function filterOptions(options: ComboboxOption[], query: string): ComboboxOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) => [option.label, option.value, option.description, ...(option.keywords ?? [])]
    .filter(Boolean).join(' ').toLowerCase().includes(needle));
}

export function comboboxOpeningQuery(options: ComboboxOption[], value: string, displayLabel = false): string {
  const exact = options.some((option) => option.value === value || (displayLabel && option.label === value));
  return exact ? '' : value;
}

const chevronSvg = comboChevronIcon;
const checkSvg = comboCheckIcon;

function optionMarkup(option: ComboboxOption, index: number, selected = false): string {
  return `<button type="button" class="combo-option" role="option" data-combo-index="${index}" aria-selected="${selected}">
    <span class="combo-option-copy"><span><strong>${escapeHtml(option.label)}</strong><code>${escapeHtml(option.value)}</code></span>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ''}</span>
    <span class="combo-option-icon">${checkSvg}</span>
  </button>`;
}

export function comboboxMarkup(config: ComboboxConfig): string {
  const listId = `${config.id}-listbox`;
  const options = filterOptions(config.options, '');
  return `<div class="combobox" data-combobox="${escapeHtml(config.id)}">
    <div class="combo-control">
      <input id="${escapeHtml(config.id)}" class="combo-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${escapeHtml(listId)}" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(config.placeholder ?? '')}" value="${escapeHtml(config.value)}">
      <button type="button" class="combo-toggle" tabindex="-1" aria-label="Open options" aria-controls="${escapeHtml(listId)}">${chevronSvg}</button>
    </div>
    <div id="${escapeHtml(listId)}" class="combo-list" role="listbox" hidden>${options.map((option, index) => optionMarkup(option, index, option.value === config.value || (config.displayLabel === true && option.label === config.value))).join('')}</div>
  </div>`;
}

export function mountCombobox(container: HTMLElement, config: ComboboxConfig): ComboboxController {
  let options = [...config.options];
  let emptyText = config.emptyText ?? 'No matching options';
  let activeIndex = -1;
  let open = false;
  container.innerHTML = comboboxMarkup(config);
  const root = container.querySelector<HTMLElement>('.combobox') as HTMLElement;
  const input = container.querySelector<HTMLInputElement>('.combo-input') as HTMLInputElement;
  const toggle = container.querySelector<HTMLButtonElement>('.combo-toggle') as HTMLButtonElement;
  const list = container.querySelector<HTMLElement>('.combo-list') as HTMLElement;
  input.readOnly = config.searchable === false;

  function display(value: string, option?: ComboboxOption): string {
    return config.displayLabel && option ? option.label : value;
  }

  function selectedOption(value: string): ComboboxOption | undefined {
    return options.find((option) => option.value === value || (config.displayLabel && option.label === value));
  }

  function renderOptions(query = ''): ComboboxOption[] {
    const filtered = filterOptions(options, config.searchable === false ? '' : query);
    if (!filtered.length) activeIndex = -1;
    else if (activeIndex >= filtered.length) activeIndex = filtered.length - 1;
    const selected = selectedOption(input.value);
    list.innerHTML = filtered.length
      ? filtered.map((option, index) => optionMarkup(option, index, option.value === selected?.value)).join('')
      : `<div class="combo-empty">${escapeHtml(emptyText)}</div>`;
    for (const [index, button] of [...list.querySelectorAll<HTMLButtonElement>('[data-combo-index]')].entries()) {
      button.classList.toggle('active', index === activeIndex);
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => choose(filtered[index]));
    }
    return filtered;
  }

  function setOpen(value: boolean, query = input.value): void {
    open = value;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    root.classList.toggle('open', open);
    if (open) renderOptions(config.searchable === false ? '' : query);
  }

  function openingQuery(): string {
    return comboboxOpeningQuery(options, input.value, config.displayLabel);
  }

  function choose(option: ComboboxOption | undefined): void {
    if (!option) return;
    input.value = display(option.value, option);
    setOpen(false);
    config.onChange?.(option.value, option);
  }

  function moveActive(delta: number): void {
    const filtered = renderOptions(config.searchable === false ? '' : openingQuery());
    if (!filtered.length) return;
    activeIndex = activeIndex < 0
      ? (delta > 0 ? 0 : filtered.length - 1)
      : (activeIndex + delta + filtered.length) % filtered.length;
    renderOptions(config.searchable === false ? '' : openingQuery());
    list.querySelector<HTMLElement>('.combo-option.active')?.scrollIntoView({ block: 'nearest' });
  }

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (!root.contains(event.target as Node)) setOpen(false);
  };
  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && open) { setOpen(false); input.focus(); }
  };
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeyDown);

  input.addEventListener('focus', () => setOpen(true, openingQuery()));
  input.addEventListener('click', () => setOpen(true, openingQuery()));
  input.addEventListener('input', () => {
    activeIndex = 0;
    setOpen(true, input.value);
    if (config.allowCustom) config.onChange?.(input.value, selectedOption(input.value));
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const filtered = filterOptions(options, config.searchable === false ? '' : openingQuery());
      if (activeIndex >= 0) choose(filtered[activeIndex]);
      else if (config.allowCustom) { setOpen(false); config.onChange?.(input.value); }
    }
  });
  toggle.addEventListener('pointerdown', (event) => event.preventDefault());
  toggle.addEventListener('click', () => {
    if (open) { setOpen(false); return; }
    setOpen(true, '');
    input.focus({ preventScroll: true });
  });

  return {
    setOptions(next, message) {
      options = [...next];
      if (message) emptyText = message;
      renderOptions(config.searchable === false ? '' : openingQuery());
    },
    setValue(value) {
      const option = selectedOption(value);
      input.value = display(value, option);
    },
    focus() { input.focus(); },
    destroy() {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
      container.innerHTML = '';
    },
  };
}
