import { Inbox } from 'lucide-react';

export default function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <Inbox size={40} className="text-[var(--muted-foreground)] mb-3 opacity-50" />
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-[var(--muted-foreground)] mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
