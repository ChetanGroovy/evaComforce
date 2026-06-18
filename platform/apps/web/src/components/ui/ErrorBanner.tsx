interface Props {
  message: string;
}

export function ErrorBanner({ message }: Props) {
  return (
    <div
      className="flex items-start gap-[9px] p-[11px_13px] rounded-[var(--radius-sm)] text-[12.5px] leading-[1.5] animate-[fade-in_200ms_ease]"
      style={{
        background: 'var(--red-soft)',
        border: '1px solid var(--red-border)',
        color: 'var(--red)',
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0, marginTop: 1 }}
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 5v4M8 11v.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}
