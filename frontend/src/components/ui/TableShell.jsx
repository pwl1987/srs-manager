// Panel-style table container with horizontal scroll for narrow screens.
export default function TableShell({ children, className = '' }) {
  return (
    <div
      className={`bg-[var(--card)] rounded-xl border border-[var(--border-soft)] overflow-x-auto shadow-[var(--shadow-panel)] ${className}`}
    >
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}
