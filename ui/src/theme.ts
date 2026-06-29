export type ThemeName = 'dark' | 'light';
const storageKey = 'agents-crew-theme';

export function resolveInitialTheme(stored: string | null, prefersDark: boolean): ThemeName {
  if (stored === 'dark' || stored === 'light') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try { localStorage.setItem(storageKey, theme); } catch { /* unavailable in private or restricted contexts */ }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
    button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  }
}

export function mountThemeToggle(): ThemeName {
  let stored: string | null = null;
  try { stored = localStorage.getItem(storageKey); } catch { /* use OS preference */ }
  const theme = resolveInitialTheme(stored, window.matchMedia('(prefers-color-scheme: dark)').matches);
  applyTheme(theme);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
    button.addEventListener('click', () => applyTheme(button.dataset.theme as ThemeName));
  }
  return theme;
}
