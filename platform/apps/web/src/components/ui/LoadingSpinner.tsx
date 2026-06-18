interface Props {
  text?: string;
}

export function LoadingSpinner({ text }: Props) {
  return (
    <div className="flex items-center gap-[10px] text-[var(--text-muted)] text-[13px] p-[18px_16px]">
      <div className="loading-spinner" />
      {text ?? 'Loading…'}
    </div>
  );
}
