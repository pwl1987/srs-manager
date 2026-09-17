import { useState, useCallback } from 'react';
import { getErrorCode } from './error-mapper';

export function useErrorHandler() {
  const [error, setError] = useState(null);

  const handleError = useCallback((err) => {
    setError({
      code: getErrorCode(err),
      detail: err.detail || null,
      timestamp: Date.now(),
    });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { error, handleError, clearError };
}
