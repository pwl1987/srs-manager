import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Locale-aware formatters live in i18n/format.js; re-exported here so
// existing `lib/utils` imports keep working.
export { formatBytes, formatDateTime as formatTime, formatDateTime, formatDate } from '../i18n/format';

export function statusColor(status) {
  switch (status) {
    case 'online': return 'text-[var(--success)]';
    case 'active': return 'text-[var(--success)]';
    case 'extended': return 'text-[var(--info)]';
    case 'offline': return 'text-[var(--muted-foreground)]';
    case 'inactive': return 'text-[var(--muted-foreground)]';
    case 'revoked': return 'text-[var(--destructive)]';
    case 'expired': return 'text-[var(--warning)]';
    case 'error': return 'text-[var(--destructive)]';
    default: return 'text-[var(--muted-foreground)]';
  }
}
