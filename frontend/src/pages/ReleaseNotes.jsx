import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, GitCommitHorizontal, Rocket, Sparkles } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { CURRENT_VERSION, RELEASES } from '../lib/releases';
import { cn } from '../lib/utils';

export default function ReleaseNotes() {
  const { t, i18n } = useTranslation(['common']);
  const lang = i18n.language?.startsWith('zh') ? 'zh' : 'en';

  return (
    <div>
      <PageHeader
        eyebrow={t('common:releaseNotes.eyebrow')}
        title={t('common:releaseNotes.title')}
        subtitle={t('common:releaseNotes.subtitle')}
      />

      <section className="lux-panel relative mb-6 overflow-hidden rounded-[24px] p-5 md:p-7">
        <div className="ambient-orb ambient-orb-primary" />
        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/25 bg-[var(--primary)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--primary)]">
              <Sparkles size={13} />
              {t('common:releaseNotes.current')}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <h2 className="text-3xl font-semibold tracking-[-0.04em]">v{CURRENT_VERSION}</h2>
              <span className="mb-1 rounded-md border border-[var(--success)]/20 bg-[var(--success)]/10 px-2 py-1 text-[10px] font-semibold text-[var(--success)]">MVP</span>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--muted-foreground)]">
              {RELEASES[0].summary[lang]}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border-soft)] bg-black/15 p-4 backdrop-blur-xl md:min-w-[230px]">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">{t('common:releaseNotes.milestone')}</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
              <Rocket size={15} className="text-[var(--primary)]" />
              {t('common:releaseNotes.mvpReady')}
            </div>
            <div className="mt-2 text-[11px] leading-5 text-[var(--muted-foreground)]">{t('common:releaseNotes.mvpReadyHint')}</div>
          </div>
        </div>
      </section>

      <div className="space-y-5">
        {RELEASES.map((release, index) => (
          <article key={release.version} className={cn('lux-panel rounded-2xl p-5 md:p-6', index === 0 && 'border-[var(--primary)]/22')}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-[var(--primary)]">v{release.version}</span>
                  <span className="rounded-md bg-[var(--secondary)] px-2 py-1 text-[10px] font-medium text-[var(--muted-foreground)]">{release.stage?.[lang] || release.stage}</span>
                </div>
                <h3 className="mt-3 text-lg font-semibold tracking-[-0.02em]">{release.title[lang]}</h3>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted-foreground)]">{release.summary[lang]}</p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/35 px-3 py-2 text-[11px] text-[var(--text-faint)]">
                <GitCommitHorizontal size={13} />
                {release.date}
              </div>
            </div>

            <div className="mt-5 grid gap-2 md:grid-cols-2">
              {release.highlights[lang].map((item) => (
                <div key={item} className="flex gap-2.5 rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/24 px-3.5 py-3 text-xs leading-5 text-[var(--muted-foreground)]">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--success)]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
