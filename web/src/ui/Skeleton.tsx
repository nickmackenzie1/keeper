/** Grey placeholder shapes while a screen loads its data. */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div class="screen" aria-busy="true" aria-label="Loading">
      <div class="screen-head">
        <span class="sk sk-title" />
        <span class="sk sk-bar" />
      </div>
      <div class="screen-body">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} class="sk-row">
            <span class="sk sk-thumb" />
            <span class="stack grow">
              <span class="sk sk-line" />
              <span class="sk sk-line short" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
