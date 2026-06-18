import { type ReactNode, useEffect } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  ariaLabel?: string;
}

export function Modal({ title, onClose, children, footer, ariaLabel }: Props) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 24,
              lineHeight: 1,
              cursor: 'pointer',
              padding: '0 4px',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">{children}</div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '16px 22px',
            borderTop: '1px solid var(--border)',
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

interface BtnGhostProps {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}

export function BtnGhost({ onClick, children, disabled }: BtnGhostProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'none',
        border: '1px solid var(--border)',
        color: 'var(--btn-soft-fg)',
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 13,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {children}
    </button>
  );
}

interface BtnPrimaryProps {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}

export function BtnPrimary({ onClick, children, disabled }: BtnPrimaryProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'linear-gradient(135deg, #5b8ef0, #bf5af2)',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '8px 18px',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {children}
    </button>
  );
}

interface ModalMsgProps {
  text: string;
  kind: 'ok' | 'err' | 'neutral';
}

export function ModalMsg({ text, kind }: ModalMsgProps) {
  const color =
    kind === 'ok' ? 'var(--msg-ok)' :
    kind === 'err' ? 'var(--msg-err)' :
    'var(--text-muted)';
  return (
    <div style={{ fontSize: 12.5, minHeight: 16, color }}>{text}</div>
  );
}
