import { useCallback, useSyncExternalStore } from 'react';

/* ── Themes ──────────────────────────────────────────── */
export type Theme = 'dark' | 'light' | 'slate' | 'contrast' | 'solarized';

export interface ThemeMeta {
  id: Theme;
  label: string;
  /** representative swatch colours [background, accent] for the picker */
  swatch: [string, string];
  group: 'dark' | 'light';
}

export const THEMES: ThemeMeta[] = [
  { id: 'dark', label: 'Midnight', swatch: ['#0e1219', '#5b8ef0'], group: 'dark' },
  { id: 'slate', label: 'Slate', swatch: ['#1b2129', '#6ea8c8'], group: 'dark' },
  { id: 'contrast', label: 'High Contrast', swatch: ['#000000', '#ffd02e'], group: 'dark' },
  { id: 'light', label: 'Daylight', swatch: ['#ffffff', '#3f73d6'], group: 'light' },
  { id: 'solarized', label: 'Solarized', swatch: ['#fdf6e3', '#268bd2'], group: 'light' },
];

const THEME_IDS = THEMES.map((t) => t.id);

/* ── Text size ───────────────────────────────────────── */
export type TextSize = 'compact' | 'comfortable' | 'large';

export interface TextSizeMeta {
  id: TextSize;
  label: string;
}

export const TEXT_SIZES: TextSizeMeta[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'large', label: 'Large' },
];

const TEXT_SIZE_IDS = TEXT_SIZES.map((t) => t.id);

/* ── Persistence ─────────────────────────────────────── */
const THEME_KEY = 'comforceeva-theme';
const TEXTSIZE_KEY = 'comforceeva-textsize';

export function getInitialTheme(): Theme {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
  // legacy 'dark'/'light' values remain valid members of the union
  if (stored && (THEME_IDS as string[]).includes(stored)) return stored as Theme;
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function getInitialTextSize(): TextSize {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(TEXTSIZE_KEY) : null;
  if (stored && (TEXT_SIZE_IDS as string[]).includes(stored)) return stored as TextSize;
  return 'comfortable';
}

/** Apply theme to <html data-theme> — call once before render to avoid a flash. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Apply text size to <html data-textsize>. */
export function applyTextSize(size: TextSize): void {
  document.documentElement.setAttribute('data-textsize', size);
}

/* ── Hook ────────────────────────────────────────────── */
export interface ThemeControls {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** quick dark/light flip kept for the legacy header toggle */
  toggle: () => void;
  textSize: TextSize;
  setTextSize: (s: TextSize) => void;
  /** step text size down (-1) / up (+1); clamps at ends */
  stepTextSize: (dir: -1 | 1) => void;
}

/* ── Shared store ─────────────────────────────────────
   A single module-level store so every useTheme() consumer reads and
   writes the same state — avoids desync between multiple mounted menus. */
let themeValue: Theme = getInitialTheme();
let textSizeValue: TextSize = getInitialTextSize();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function commitTheme(t: Theme) {
  if (t === themeValue) return;
  themeValue = t;
  applyTheme(t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore storage errors (private mode) */
  }
  emit();
}

function commitTextSize(s: TextSize) {
  if (s === textSizeValue) return;
  textSizeValue = s;
  applyTextSize(s);
  try {
    localStorage.setItem(TEXTSIZE_KEY, s);
  } catch {
    /* ignore */
  }
  emit();
}

const getTheme = () => themeValue;
const getTextSize = () => textSizeValue;

export function useTheme(): ThemeControls {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  const textSize = useSyncExternalStore(subscribe, getTextSize, getTextSize);

  const setTheme = useCallback((t: Theme) => commitTheme(t), []);
  const setTextSize = useCallback((s: TextSize) => commitTextSize(s), []);

  const stepTextSize = useCallback((dir: -1 | 1) => {
    const i = TEXT_SIZE_IDS.indexOf(textSizeValue);
    const next = Math.min(TEXT_SIZE_IDS.length - 1, Math.max(0, i + dir));
    commitTextSize(TEXT_SIZE_IDS[next] as TextSize);
  }, []);

  const toggle = useCallback(() => {
    const meta = THEMES.find((m) => m.id === themeValue);
    commitTheme(meta?.group === 'light' ? 'dark' : 'light');
  }, []);

  return { theme, setTheme, toggle, textSize, setTextSize, stepTextSize };
}
