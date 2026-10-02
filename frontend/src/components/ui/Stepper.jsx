import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

// Display-only stepper: the wizard owns navigation so steps can be revisited
// only up to the furthest validated step.
export default function Stepper({ steps, current, maxReached, onSelect, t = key => key }) {
  return <ol className="flex flex-wrap items-center gap-1" aria-label={t('common:actions.steps')}>
    {steps.map((step, index) => {
      const done = index < current || (index <= maxReached && index !== current);
      const active = index === current;
      const reachable = index <= maxReached;
      return <li key={step.key} className="flex items-center gap-1">
        <button
          type="button"
          disabled={!reachable || active}
          onClick={() => reachable && onSelect?.(index)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            active ? 'border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]'
              : done ? 'border-[var(--success)]/25 bg-[var(--success)]/8 text-[var(--success)]'
                : 'border-[var(--border-soft)] bg-[var(--secondary)] text-[var(--muted-foreground)]',
            reachable && !active && 'cursor-pointer hover:border-[var(--primary)]/30'
          )}
        >
          <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold',
            active ? 'bg-[var(--primary)] text-[var(--background)]' : done ? 'bg-[var(--success)] text-[var(--background)]' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]')}>
            {done ? <Check size={10} /> : index + 1}
          </span>
          {step.label}
        </button>
        {index < steps.length - 1 && <span className="h-px w-4 bg-[var(--border-soft)]" />}
      </li>;
    })}
  </ol>;
}
