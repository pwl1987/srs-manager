import React from 'react';
import { Search, X } from 'lucide-react';

export default function SearchInput({ value, onChange, placeholder, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full md:w-72 min-h-9 pl-9 pr-8 py-2 rounded-lg bg-[var(--input)] border border-[var(--border)] text-sm placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow,background-color] focus:outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/15"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
