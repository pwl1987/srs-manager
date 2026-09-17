// Card-style table container with horizontal scroll for narrow screens.
export default function TableShell({ children, className = '' }) {
  return (
    <div className={`bg-[var(--card)] rounded-lg border overflow-x-auto ${className}`}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
