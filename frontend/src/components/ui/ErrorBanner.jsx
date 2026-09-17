import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

export default function ErrorBanner({ message, onRetry }) {
  const { t } = useTranslation(['common']);
  return (
    <div className="bg-[var(--destructive)]/10 border border-[var(--destructive)]/30 rounded-lg p-4 mb-4 flex items-start gap-3">
      <AlertTriangle size={16} className="text-[var(--destructive)] shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-[var(--destructive)] text-sm">{message}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-2 text-sm text-[var(--primary)] hover:underline">
            {t('common:status.retry')}
          </button>
        )}
      </div>
    </div>
  );
}
