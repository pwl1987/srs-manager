// Animated placeholder rows for list pages.
export function TableSkeleton({ rows = 4 }) {
  return (
    <div className="bg-[var(--card)] rounded-xl border border-[var(--border-soft)] shadow-[var(--shadow-panel)] divide-y divide-[var(--border-soft)] overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
          <div className="h-3.5 bg-[var(--secondary)] rounded-md w-1/4" />
          <div className="h-3.5 bg-[var(--secondary)] rounded-md w-1/5" />
          <div className="h-3.5 bg-[var(--secondary)] rounded-md w-1/6" />
          <div className="h-3.5 bg-[var(--secondary)] rounded-md w-1/6 ml-auto" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className = '' }) {
  return (
    <div
      className={`bg-[var(--card)] rounded-xl border border-[var(--border-soft)] shadow-[var(--shadow-panel)] p-4 animate-pulse ${className}`}
    />
  );
}
