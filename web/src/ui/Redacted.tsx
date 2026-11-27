/** Information that hasn't arrived yet, shown the way a case file hides it: black bars and a stamp. */
export function Redacted({ label = "Data pending", lines = 1 }: { label?: string; lines?: number }) {
  return (
    <span class="redacted" role="status" aria-label={`${label}…`}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} class={`redact-bar ${i === lines - 1 && lines > 1 ? "short" : ""}`} aria-hidden="true" />
      ))}
      <span class="redact-tag" aria-hidden="true">[{label}]</span>
    </span>
  );
}
