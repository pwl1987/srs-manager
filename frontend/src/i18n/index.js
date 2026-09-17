import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCNCommon from './locales/zh-CN/common.json';
import zhCNStreams from './locales/zh-CN/streams.json';
import zhCNChannels from './locales/zh-CN/cdn-channels.json';
import zhCNDns from './locales/zh-CN/dns-records.json';
import zhCNDistribution from './locales/zh-CN/distribution.json';
import zhCNMonitor from './locales/zh-CN/monitor.json';
import zhCNAuth from './locales/zh-CN/auth.json';
import zhCNSettings from './locales/zh-CN/settings.json';
import zhCNForwarding from './locales/zh-CN/forwarding.json';
import zhCNTranscode from './locales/zh-CN/transcode-templates.json';
import zhCNLogin from './locales/zh-CN/login.json';
import enUSCommon from './locales/en-US/common.json';
import enUSStreams from './locales/en-US/streams.json';
import enUSChannels from './locales/en-US/cdn-channels.json';
import enUSDns from './locales/en-US/dns-records.json';
import enUSDistribution from './locales/en-US/distribution.json';
import enUSMonitor from './locales/en-US/monitor.json';
import enUSAuth from './locales/en-US/auth.json';
import enUSSettings from './locales/en-US/settings.json';
import enUSForwarding from './locales/en-US/forwarding.json';
import enUSTranscode from './locales/en-US/transcode-templates.json';
import enUSLogin from './locales/en-US/login.json';

const LANG_KEY = 'srs-manager-lang';

function detectLanguage() {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'zh-CN' || saved === 'en-US') return saved;
  const nav = navigator.language || navigator.userLanguage || 'zh-CN';
  return nav.startsWith('zh') ? 'zh-CN' : 'en-US';
}

i18next.use(initReactI18next).init({
  lng: detectLanguage(),
  fallbackLng: 'en-US',
  fallbackNs: ['common'],
  resources: {
    'zh-CN': {
      common: zhCNCommon,
      streams: zhCNStreams,
      channels: zhCNChannels,
      dns: zhCNDns,
      distribution: zhCNDistribution,
      monitor: zhCNMonitor,
      auth: zhCNAuth,
      settings: zhCNSettings,
      forwarding: zhCNForwarding,
      transcode: zhCNTranscode,
      login: zhCNLogin
    },
    'en-US': {
      common: enUSCommon,
      streams: enUSStreams,
      channels: enUSChannels,
      dns: enUSDns,
      distribution: enUSDistribution,
      monitor: enUSMonitor,
      auth: enUSAuth,
      settings: enUSSettings,
      forwarding: enUSForwarding,
      transcode: enUSTranscode,
      login: enUSLogin
    }
  },
  interpolation: { escapeValue: false },
  react: { useSuspense: false }
});

document.documentElement.lang = i18next.language;

export function setLanguage(lng) {
  i18next.changeLanguage(lng);
  localStorage.setItem(LANG_KEY, lng);
  document.documentElement.lang = lng;
}

export function getLanguage() {
  return i18next.language;
}

export default i18next;
