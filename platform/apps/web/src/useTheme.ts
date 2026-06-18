import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'comforceeva-theme';

export function getInitialTheme(): Theme {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  if (stored === 'dark' || stored === 'light') return stored;
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

/** Apply the theme to <html data-theme> — call once before render to avoid a flash. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore storage errors (private mode) */
    }
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}
