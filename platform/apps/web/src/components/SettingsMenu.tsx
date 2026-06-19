import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTheme, THEMES, TEXT_SIZES, type Theme, type TextSize } from '../useTheme';

const TEXT_SIZE_ORDER: TextSize[] = TEXT_SIZES.map((t) => t.id);
const THEME_ORDER: Theme[] = THEMES.map((t) => t.id);

export function SettingsMenu() {
  const { theme, setTheme, textSize, setTextSize, stepTextSize } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const themeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const sizeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Close on click-outside + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Move focus into the panel (active theme) when it opens
  useEffect(() => {
    if (!open) return;
    const i = THEME_ORDER.indexOf(theme);
    // defer to after the panel paints
    const id = requestAnimationFrame(() => themeRefs.current[i]?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const sizeIdx = TEXT_SIZE_ORDER.indexOf(textSize);

  // Roving radiogroup keyboard nav (vertical for themes, horizontal for sizes)
  function radioKeyDown<T>(
    e: KeyboardEvent<HTMLButtonElement>,
    order: T[],
    current: T,
    select: (v: T) => void,
    refs: (HTMLButtonElement | null)[],
  ) {
    const i = order.indexOf(current);
    let next = i;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (i + 1) % order.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (i - 1 + order.length) % order.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = order.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const target = order[next];
    if (target === undefined) return;
    select(target);
    refs[next]?.focus();
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className="settings-trigger"
        onClick={() => setOpen((o) => !o)}
        title="Appearance settings"
        aria-label="Appearance settings"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className="settings-panel" role="dialog" aria-modal="false" aria-label="Appearance settings">
          {/* Theme picker */}
          <div className="settings-section-label" id="settings-theme-label">Theme</div>
          <div className="settings-theme-grid" role="radiogroup" aria-labelledby="settings-theme-label">
            {THEMES.map((t, idx) => {
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  ref={(el) => { themeRefs.current[idx] = el; }}
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  className={`settings-theme-opt${active ? ' is-active' : ''}`}
                  onClick={() => setTheme(t.id)}
                  onKeyDown={(e) => radioKeyDown(e, THEME_ORDER, theme, setTheme, themeRefs.current)}
                  title={t.label}
                >
                  <span
                    className="settings-swatch"
                    style={{ background: t.swatch[0], borderColor: t.swatch[1] }}
                  >
                    <span className="settings-swatch-dot" style={{ background: t.swatch[1] }} />
                  </span>
                  <span className="settings-theme-name">{t.label}</span>
                  {active && (
                    <svg className="settings-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          {/* Text size stepper */}
          <div className="settings-divider" />
          <div className="settings-section-label" id="settings-size-label">Text size</div>
          <div className="settings-textsize">
            <button
              className="settings-step-btn"
              onClick={() => stepTextSize(-1)}
              disabled={sizeIdx <= 0}
              aria-label="Decrease text size"
              title="Smaller"
            >
              <span style={{ fontSize: '0.85em' }}>A</span>
            </button>
            <div className="settings-textsize-track" role="radiogroup" aria-labelledby="settings-size-label">
              {TEXT_SIZES.map((s, idx) => {
                const active = s.id === textSize;
                return (
                  <button
                    key={s.id}
                    ref={(el) => { sizeRefs.current[idx] = el; }}
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    className={`settings-textsize-opt${active ? ' is-active' : ''}`}
                    onClick={() => setTextSize(s.id)}
                    onKeyDown={(e) => radioKeyDown(e, TEXT_SIZE_ORDER, textSize, setTextSize, sizeRefs.current)}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <button
              className="settings-step-btn"
              onClick={() => stepTextSize(1)}
              disabled={sizeIdx >= TEXT_SIZE_ORDER.length - 1}
              aria-label="Increase text size"
              title="Larger"
            >
              <span style={{ fontSize: '1.15em' }}>A</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
