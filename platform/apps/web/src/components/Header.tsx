import { useTheme } from '../useTheme';

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle color theme"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'background var(--t-fast), color var(--t-fast), border-color var(--t-fast)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-primary)';
        e.currentTarget.style.borderColor = 'var(--border-bright)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-secondary)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

export function Header() {
  return (
    <header className="app-header">
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div
          style={{
            width: 34,
            height: 34,
            background: 'linear-gradient(140deg, #5b8ef0 0%, #bf5af2 100%)',
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 800,
            color: '#fff',
            letterSpacing: '-0.5px',
            flexShrink: 0,
            boxShadow: '0 2px 8px rgba(91,142,240,0.35)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          cE
          <span
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 55%)',
              borderRadius: 'inherit',
            }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            comforce<span style={{ color: 'var(--accent-bright)' }}>Eva</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, letterSpacing: '0.1px' }}>
            AI Patient Prescreening Engine
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 22, background: 'var(--border)' }} />

      {/* Meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Real-time screening
      </div>

      <div style={{ flex: 1 }} />

      {/* Theme toggle */}
      <ThemeToggle />

      {/* Demo badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.2px',
          color: 'var(--accent-bright)',
          background: 'var(--accent-soft)',
          border: '1px solid rgba(91,142,240,0.25)',
          borderRadius: 'var(--radius-pill)',
          padding: '4px 12px 4px 10px',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <polygon points="3,1 13,8 3,15" fill="currentColor" opacity="0.7" />
        </svg>
        Live Demo
      </div>

      {/* Live badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--green)',
          background: 'var(--green-soft)',
          border: '1px solid var(--green-border)',
          borderRadius: 'var(--radius-pill)',
          padding: '4px 11px',
        }}
      >
        <div className="status-dot" />
        Online
      </div>
    </header>
  );
}
