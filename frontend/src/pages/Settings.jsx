import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { formatTime } from '../lib/utils';
import { getErrorCode } from '../lib/error-mapper';
import PageHeader from '../components/ui/PageHeader';
import ErrorBanner from '../components/ui/ErrorBanner';
import { inputClass, labelClass, btnPrimary, btnSecondary, helpTextClass } from '../components/ui/styles';
import { Server, Clock, RefreshCw, Globe, Plug } from 'lucide-react';

export default function Settings() {
  const { t } = useTranslation(['settings', 'common']);
  const [loadError, setLoadError] = useState(null);
  const [srsConfig, setSrsConfig] = useState(null);
  const [ntpStatus, setNtpStatus] = useState(null);
  const [form, setForm] = useState({
    api_url: '', api_token: '', rtmp_port: 1935,
    dns_domain: '', cdn_domain: '', timezone: 'Asia/Shanghai'
  });
  const [tokenTouched, setTokenTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [checkingNtp, setCheckingNtp] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoadError(null);
    try {
      const [cfg, ntp, all] = await Promise.all([
        api.get('/settings/srs-config'),
        api.get('/settings/ntp-status'),
        api.get('/settings')
      ]);
      setSrsConfig(cfg);
      setNtpStatus(ntp);
      setForm({
        api_url: cfg.api_url || '',
        api_token: '',
        rtmp_port: cfg.rtmp_port || 1935,
        dns_domain: all.dns_domain || '',
        cdn_domain: all.cdn_domain || '',
        timezone: all.timezone || 'Asia/Shanghai'
      });
      setTokenTouched(false);
    } catch (err) {
      setLoadError({ code: getErrorCode(err) });
    }
  }

  async function checkNtp() {
    setCheckingNtp(true);
    try {
      setNtpStatus(await api.get('/settings/ntp-status'));
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setCheckingNtp(false);
    }
  }

  async function testSrs() {
    setTesting(true);
    try {
      const res = await api.get('/settings/test-srs');
      toast.success(t('settings:srs.testSuccess', { version: res.version || '?' }));
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        srs_api_url: form.api_url,
        srs_rtmp_port: parseInt(form.rtmp_port, 10) || 1935,
        dns_domain: form.dns_domain,
        cdn_domain: form.cdn_domain,
        timezone: form.timezone
      };
      if (tokenTouched && form.api_token) payload.srs_api_token = form.api_token;
      await api.put('/settings', payload);
      toast.success(t('common:toasts.saved'));
      loadAll();
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('settings:title')}
        subtitle={t('settings:subtitle')}
        actions={
          <button className={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? t('common:status.saving') : t('settings:save')}
          </button>
        }
      />

      {loadError && <ErrorBanner message={t(`common:errors.${loadError.code}`)} onRetry={loadAll} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SRS connection */}
        <div className="bg-[var(--card)] rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Server size={20} className="text-[var(--primary)]" />
              <h3 className="text-sm font-bold">{t('settings:sections.srs')}</h3>
            </div>
            <button className={btnSecondary} onClick={testSrs} disabled={testing}>
              <Plug size={14} /> {testing ? t('settings:srs.testing') : t('settings:srs.testConnection')}
            </button>
          </div>
          {srsConfig ? (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>{t('settings:srs.apiUrl')}</label>
                <input
                  type="text"
                  value={form.api_url}
                  onChange={e => setForm({ ...form, api_url: e.target.value })}
                  className={`${inputClass} font-mono`}
                  placeholder="http://10.0.0.1:1985/api/v1"
                />
              </div>
              <div>
                <label className={labelClass}>
                  {t('settings:srs.apiToken')}
                  {srsConfig.api_token_set && (
                    <span className="ml-2 text-xs text-[var(--success)]">{t('settings:srs.apiTokenSet')}</span>
                  )}
                </label>
                <input
                  type="password"
                  value={form.api_token}
                  onChange={e => { setForm({ ...form, api_token: e.target.value }); setTokenTouched(true); }}
                  className={inputClass}
                  placeholder={t('settings:srs.apiTokenPlaceholder')}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>{t('settings:srs.rtmpPort')}</label>
                  <input
                    type="number"
                    value={form.rtmp_port}
                    onChange={e => setForm({ ...form, rtmp_port: e.target.value })}
                    className={inputClass}
                    min={1}
                    max={65535}
                  />
                </div>
                <div>
                  <label className={labelClass}>{t('settings:srs.hooks')}</label>
                  <p className="text-sm py-2">{srsConfig.hooks_enabled ? t('common:labels.yes') : t('common:labels.no')}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">{t('common:page.loading')}</p>
          )}
        </div>

        {/* NTP */}
        <div className="bg-[var(--card)] rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock size={20} className="text-[var(--primary)]" />
              <h3 className="text-sm font-bold">{t('settings:ntp.title')}</h3>
            </div>
            <button className={btnSecondary} onClick={checkNtp} disabled={checkingNtp}>
              <RefreshCw size={14} className={checkingNtp ? 'animate-spin' : ''} /> {t('common:actions.refresh')}
            </button>
          </div>
          {ntpStatus ? (
            <div className="space-y-3 text-sm">
              {ntpStatus.supported === false ? (
                <p className="text-[var(--muted-foreground)]">{t('settings:ntp.unsupported')}</p>
              ) : (
                <>
                  <div>
                    <span className="text-[var(--muted-foreground)]">{t('settings:ntp.status')}: </span>
                    <span className={ntpStatus.synced ? 'text-[var(--success)]' : 'text-[var(--destructive)]'}>
                      {ntpStatus.synced ? t('settings:ntp.synced') : t('settings:ntp.notSynced')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--muted-foreground)]">{t('settings:ntp.service')}: </span>
                    <span className={ntpStatus.ntp_active ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                      {ntpStatus.ntp_active ? t('settings:ntp.active') : t('settings:ntp.inactive')}
                    </span>
                  </div>
                </>
              )}
              <div><span className="text-[var(--muted-foreground)]">{t('settings:ntp.time')}: </span>{formatTime(ntpStatus.system_time)}</div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">{t('common:page.loading')}</p>
          )}
          <p className={helpTextClass}>{t('settings:ntp.note')}</p>
        </div>

        {/* DNS domains */}
        <div className="bg-[var(--card)] rounded-lg border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Globe size={20} className="text-[var(--primary)]" />
            <h3 className="text-sm font-bold">{t('settings:sections.dns')}</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>{t('settings:dns.baseDomain')}</label>
              <input
                type="text"
                value={form.dns_domain}
                onChange={e => setForm({ ...form, dns_domain: e.target.value })}
                placeholder={t('settings:dns.baseDomainHelper')}
                className={inputClass}
              />
              <p className={helpTextClass}>{t('settings:dns.baseDomainHelper')}</p>
            </div>
            <div>
              <label className={labelClass}>{t('settings:dns.cdnDomain')}</label>
              <input
                type="text"
                value={form.cdn_domain}
                onChange={e => setForm({ ...form, cdn_domain: e.target.value })}
                placeholder={t('settings:dns.cdnDomainHelper')}
                className={inputClass}
              />
              <p className={helpTextClass}>{t('settings:dns.cdnDomainHelper')}</p>
            </div>
          </div>
        </div>

        {/* General */}
        <div className="bg-[var(--card)] rounded-lg border p-6">
          <h3 className="text-sm font-bold mb-4">{t('settings:sections.general')}</h3>
          <div>
            <label className={labelClass}>{t('settings:general.timezone')}</label>
            <select
              value={form.timezone}
              onChange={e => setForm({ ...form, timezone: e.target.value })}
              className={inputClass}
            >
              <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New_York (UTC-5)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
