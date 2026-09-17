// One-off transform: t('ns.key') -> t('ns:key'), bare common-ns keys -> t('common:key').
// Usage: node scripts/transform-i18n-prefix.cjs
const fs = require('fs');
const path = require('path');

// Root boundary: every touched file must resolve inside src/.
const SRC = path.resolve(__dirname, '..', 'src');

const NS = ['common', 'streams', 'channels', 'dns', 'distribution', 'monitor', 'auth', 'settings', 'forwarding', 'transcode', 'login'];
// Unprefixed keys that live in common.json top level
const COMMON_KEYS = ['toasts', 'errors', 'navigation', 'brand', 'actions', 'language', 'labels', 'status', 'page', 'confirm'];

const FILES = [
  'App.jsx',
  'pages/AliyunDnsAuth.jsx',
  'pages/AuthKeys.jsx',
  'pages/CdnChannels.jsx',
  'pages/Dashboard.jsx',
  'pages/Distribution.jsx',
  'pages/DnsRecords.jsx',
  'pages/Forwarding.jsx',
  'pages/Login.jsx',
  'pages/Monitor.jsx',
  'pages/Settings.jsx',
  'pages/Streams.jsx',
  'pages/TranscodeTemplates.jsx',
  'pages/WangsuAuth.jsx',
  'components/layout/Sidebar.jsx',
  'components/layout/Header.jsx',
];

// t('word.  or  t(`word.
const PATTERN = /t\((['`])([a-zA-Z][a-zA-Z0-9]*)\./g;

function resolveInsideSrc(rel) {
  const target = path.resolve(SRC, rel);
  if (target !== SRC && !target.startsWith(SRC + path.sep)) {
    throw new Error(`Refusing to touch outside src/: ${rel}`);
  }
  return target;
}

let totalReplaced = 0;
const problems = [];

for (const rel of FILES) {
  const file = resolveInsideSrc(rel);
  let content = fs.readFileSync(file, 'utf8');
  let count = 0;

  content = content.replace(PATTERN, (match, quote, word) => {
    if (NS.includes(word)) {
      count++;
      return `t(${quote}${word}:`;
    }
    if (COMMON_KEYS.includes(word)) {
      count++;
      return `t(${quote}common:${word}.`;
    }
    problems.push(`${rel}: unknown prefix "${word}." in ${match}`);
    return match;
  });

  fs.writeFileSync(file, content);

  // Post-check: any remaining dotted-prefix t() call?
  const leftovers = content.match(/t\((['`])[a-zA-Z][a-zA-Z0-9]*\./g) || [];
  const bad = leftovers.filter(s => {
    const m = s.match(/t\((['`])([a-zA-Z][a-zA-Z0-9]*)\./);
    return !m || !NS.includes(m[2]);
  });
  if (bad.length) problems.push(`${rel}: leftover unprefixed t() calls: ${bad.join(', ')}`);
  console.log(`${rel}: ${count} replaced`);
  totalReplaced += count;
}

console.log(`\nTotal replaced: ${totalReplaced}`);
if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.forEach(p => console.log('  ' + p));
  process.exit(1);
}
console.log('All t() calls now use ns:key syntax.');
