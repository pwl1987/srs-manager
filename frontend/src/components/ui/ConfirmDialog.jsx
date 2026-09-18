import React from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { btnDangerSolid, btnPrimary, btnSecondary } from './styles';

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = true,
  confirming = false,
}) {
  const { t } = useTranslation(['common']);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className={btnSecondary} onClick={onClose} disabled={confirming}>
            {cancelLabel || t('common:actions.cancel')}
          </button>
          <button
            className={danger ? btnDangerSolid : btnPrimary}
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirmLabel || t('common:actions.confirm')}
          </button>
        </>
      }
    >
      {description && <p className="text-sm text-[var(--muted-foreground)]">{description}</p>}
    </Modal>
  );
}
