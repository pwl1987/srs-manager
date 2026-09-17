import i18n from '@/i18n';
import { MESSAGE_MAP } from './error-messages';

const STATUS_MAP = {
  401: 'AUTH_UNAUTHORIZED',
  403: 'AUTH_FORBIDDEN',
  404: 'NOT_FOUND_GENERAL',
  500: 'INTERNAL_GENERAL',
  502: 'INTERNAL_GENERAL',
  503: 'INTERNAL_GENERAL',
};

export function getErrorCode(error) {
  if (error.code && i18n.exists(`common:errors.${error.code}`)) return error.code;
  const base = (error.message || '').split(':')[0].trim();
  const mapped = MESSAGE_MAP[base] || MESSAGE_MAP[error.message];
  if (mapped && i18n.exists(`common:errors.${mapped}`)) return mapped;
  if (error.status && STATUS_MAP[error.status]) return STATUS_MAP[error.status];
  if (error.message && !MESSAGE_MAP[error.message]) console.warn('[Unmapped error]', error.message);
  return 'INTERNAL_GENERAL';
}
