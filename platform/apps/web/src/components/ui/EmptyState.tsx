interface Props {
  icon: string;
  text: string;
}

export function EmptyState({ icon, text }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 p-[30px_16px] text-center text-[var(--text-muted)]">
      <div style={{ fontSize: 26, opacity: 0.35, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 12, lineHeight: 1.65, maxWidth: 210 }}>{text}</div>
    </div>
  );
}
