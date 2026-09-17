// Shared Tailwind class recipes so buttons/inputs/tables look identical on
// every page. Import instead of copy-pasting class strings.

export const inputClass =
  'w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]';

export const labelClass = 'block text-sm mb-1.5';

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)] transition-colors disabled:opacity-50 disabled:pointer-events-none';

export const btnSecondary =
  'inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-[var(--secondary)] text-sm hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 disabled:pointer-events-none';

export const btnDangerGhost =
  'inline-flex items-center justify-center gap-2 px-3 py-2 rounded text-[var(--destructive)] text-sm hover:bg-[var(--destructive)]/15 transition-colors disabled:opacity-50 disabled:pointer-events-none';

export const btnDangerSolid =
  'inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-[var(--destructive)] text-white text-sm hover:opacity-90 transition-colors disabled:opacity-50 disabled:pointer-events-none';

export const btnGhost =
  'inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)] transition-colors text-sm';

export const thClass =
  'text-left px-4 py-3 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider whitespace-nowrap';

export const tdClass = 'px-4 py-3 text-sm align-middle';

export const helpTextClass = 'text-xs text-[var(--muted-foreground)] mt-1';
