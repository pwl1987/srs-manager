// Shared Tailwind class recipes so buttons/inputs/tables look identical on
// every page. Import instead of copy-pasting class strings.

export const inputClass =
  'w-full min-h-10 px-3 py-2 rounded-lg bg-[var(--input)] border border-[var(--border)] text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_rgb(255_255_255/0.02)] placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow,background-color] duration-150 focus:outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/15';

export const labelClass =
  'block text-xs font-medium tracking-wide text-[var(--muted-foreground)] mb-1.5';

export const btnPrimary =
  'inline-flex min-h-9 items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium shadow-[0_8px_22px_rgb(0_0_0/0.16)] hover:bg-[var(--accent)] transition-[background-color,transform,box-shadow] duration-150 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none';

export const btnSecondary =
  'inline-flex min-h-9 items-center justify-center gap-2 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-sm font-medium text-[var(--secondary-foreground)] hover:bg-[var(--surface-hover)] hover:border-[var(--muted-foreground)]/40 transition-[background-color,border-color] duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const btnDangerGhost =
  'inline-flex min-h-9 items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-[var(--destructive)] text-sm font-medium hover:bg-[var(--destructive)]/12 transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

export const btnDangerSolid =
  'inline-flex min-h-9 items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-[var(--destructive)] text-[var(--destructive-foreground)] text-sm font-medium shadow-[0_8px_22px_rgb(0_0_0/0.16)] hover:brightness-110 transition-[filter,transform] duration-150 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none';

export const btnGhost =
  'inline-flex min-h-8 items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors duration-150 text-sm';

export const thClass =
  'text-left px-4 py-3 text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-[0.08em] whitespace-nowrap bg-[var(--muted)]/35';

export const tdClass =
  'px-4 py-3.5 text-sm align-middle text-[var(--foreground)]';

export const helpTextClass =
  'text-xs leading-relaxed text-[var(--muted-foreground)] mt-1.5';
