// Animated placeholder rows for list pages.
export function TableSkeleton({ rows = 4 }) {
  return (
    <div className="bg-[var(--card)] rounded-lg border divide-y divide-[var(--border)]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
          <div className="h-4 bg-[var(--secondary)] rounded w-1/4" />
          <div className="h-4 bg-[var(--secondary)] rounded w-1/5" />
          <div className="h-4 bg-[var(--secondary)] rounded w-1/6" />
          <div className="h-4 bg-[var(--secondary)] rounded w-1/6 ml-auto" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className = '' }) {
  return <div className={`bg-[var(--card)] rounded-lg border p-4 animate-pulse ${className}`} />;
}
