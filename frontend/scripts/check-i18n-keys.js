// i18n key consistency + resolution checker.
// Run via `npm run check-i18n` (wired into `npm run build`).
// Checks:
//   1. Key parity between zh-CN and en-US for every namespace.
//   2. Every MESSAGE_MAP error code exists in common.errors.
//   3. Every t() / i18n.exists() call in src/ resolves:
//      - key must use the explicit `ns:key` syntax,
//      - ns must be a known namespace,
//      - the key path must exist in BOTH locale JSONs,
//      - static keys must actually resolve through a real i18next instance
//        (catches separator/nesting mistakes that path-walking would miss).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import i18next from 'i18next';
import { MESSAGE_MAP } from '../src/lib/error-messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'src', 'i18n', 'locales');
const SRC_DIR = path.join(ROOT, 'src');

// Allowed locale directories (whitelist to prevent path traversal).
const ALLOWED_LANGS = ['zh-CN', 'en-US'];

// namespace -> JSON file
const NAMESPACE_FILES = {
  common: 'common.json',
  streams: 'streams.json',
  channels: 'cdn-channels.json',
  dns: 'dns-records.json',
  distribution: 'distribution.json',
  monitor: 'monitor.json',
  auth: 'auth.json',
  settings: 'settings.json',
  forwarding: 'forwarding.json',
  transcode: 'transcode-templates.json',
  login: 'login.json',
};

const errors = [];

// Recursively collect string keys of a nested object, dot-joined.
function getKeys(obj, prefix) {
  prefix = prefix || '';
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? prefix + '.' + k : k;
    if (typeof v === 'object' && v !== null) keys.push.apply(keys, getKeys(v, fullKey));
    else keys.push(fullKey);
  }
  return keys;
}

function loadLocale(lang) {
  if (ALLOWED_LANGS.indexOf(lang) === -1) {
    throw new Error('Unknown language: ' + lang);
  }
  const result = {};
  for (const [ns, file] of Object.entries(NAMESPACE_FILES)) {
    const p = path.resolve(LOCALES_DIR, lang, file);
    // Ensure the resolved path stays inside LOCALES_DIR.
    if (!p.startsWith(LOCALES_DIR + path.sep)) {
      throw new Error('Path traversal detected for locale file: ' + p);
    }
    result[ns] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return result;
}

const zh = loadLocale('zh-CN');
const en = loadLocale('en-US');

// 1. Namespace key parity
for (const ns of Object.keys(NAMESPACE_FILES)) {
  const zhKeys = new Set(getKeys(zh[ns]));
  const enKeys = new Set(getKeys(en[ns]));
  for (const key of zhKeys) {
    if (!enKeys.has(key)) errors.push('[' + ns + '] missing in en-US: ' + key);
  }
  for (const key of enKeys) {
    if (!zhKeys.has(key)) errors.push('[' + ns + '] missing in zh-CN: ' + key);
  }
}

// 2. MESSAGE_MAP codes must exist in common.errors
const commonErrorKeys = new Set(getKeys(zh.common.errors));
for (const [msg, code] of Object.entries(MESSAGE_MAP)) {
  if (!commonErrorKeys.has(code)) {
    errors.push('[MESSAGE_MAP] code not in common.errors: ' + code + ' (msg: ' + msg + ')');
  }
}

// 3. Every t()/exists() call must resolve.
// Walk a dot path into a namespace object; returns { found, value }.
function walkPath(obj, dotPath) {
  let cur = obj;
  for (const part of dotPath.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in cur)) return { found: false };
    cur = cur[part];
  }
  return { found: true, value: cur };
}

function checkKeyString(key, where) {
  const m = key.match(/^([a-zA-Z][a-zA-Z0-9]*):(.*)$/);
  if (!m) {
    errors.push(where + ': key "' + key + '" must use ns:key syntax');
    return null;
  }
  const ns = m[1];
  const subPath = m[2];
  if (!(ns in NAMESPACE_FILES)) {
    errors.push(where + ': unknown namespace "' + ns + '" in key "' + key + '"');
    return null;
  }
  if (!subPath) {
    // Bare namespace reference (e.g. `t(`ns:${x}`)`): ns validity is all we can check.
    return null;
  }
  for (const [lang, data] of [['zh-CN', zh], ['en-US', en]]) {
    const r = walkPath(data[ns], subPath);
    if (!r.found) errors.push(where + ': "' + key + '" not found in ' + lang + ' ns "' + ns + '"');
  }
  return { ns, subPath };
}

// Collect source files (skip locale JSONs).
function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (p !== SRC_DIR && !p.startsWith(SRC_DIR + path.sep)) continue;
    if (entry.isDirectory()) {
      if (entry.name === 'locales') continue;
      collectFiles(p, out);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

// Static string keys: t('...') / t("...") / exists('...')
const STATIC_KEY_RE = /\b(?:t|exists)\(\s*(['"])([^'"]+)\1/g;
// Template literal keys: t(`ns:prefix.${expr}`)
const TEMPLATE_KEY_RE = /\b(?:t|exists)\(\s*`([^`]+)`/g;

const sourceFiles = collectFiles(SRC_DIR, []);
let checkedStatic = 0;
let checkedTemplate = 0;

for (const file of sourceFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const where = rel + ':' + (i + 1);
    for (const m of line.matchAll(STATIC_KEY_RE)) {
      if (checkKeyString(m[2], where)) checkedStatic++;
    }
    for (const m of line.matchAll(TEMPLATE_KEY_RE)) {
      const staticPrefix = m[1].split('${')[0].replace(/\.$/, '');
      if (!staticPrefix) continue; // fully dynamic, nothing to check
      checkKeyString(staticPrefix, where);
      checkedTemplate++;
    }
  });
}

// 4. Empirical resolution: real i18next must resolve every static key.
const resources = {};
for (const lang of ALLOWED_LANGS) {
  resources[lang] = {};
  for (const ns of Object.keys(NAMESPACE_FILES)) {
    resources[lang][ns] = (lang === 'zh-CN' ? zh : en)[ns];
  }
}
i18next.init({ lng: 'zh-CN', fallbackLng: 'en-US', fallbackNs: ['common'], resources });

for (const file of sourceFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\bt\(\s*(['"])([^'"]+)\1/g)) {
      const key = m[2];
      if (!/^[a-zA-Z][a-zA-Z0-9]*:/.test(key)) continue; // already reported by check 3
      if (i18next.t(key) === key) {
        errors.push(rel + ':' + (i + 1) + ': i18next failed to resolve "' + key + '"');
      }
    }
  });
}

console.log('Checked ' + checkedStatic + ' static keys, ' + checkedTemplate + ' template prefixes across ' + sourceFiles.length + ' files.');

if (errors.length) {
  console.error('i18n check failed with ' + errors.length + ' issue(s):');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
} else {
  console.log('i18n check passed.');
}
