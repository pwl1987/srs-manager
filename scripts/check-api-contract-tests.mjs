import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.env.BASE_SHA || process.argv[2];
const head = process.env.HEAD_SHA || process.argv[3] || 'HEAD';
if (!base) throw new Error('BASE_SHA is required');
const changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const apiChanged = changed.filter((p) => p === 'backend/server.js' || /^backend\/routes\/.*\.js$/.test(p));
if (!apiChanged.length) {
  console.log('Contract Tests: no external API implementation changes.');
  process.exit(0);
}
const integration = changed.filter((p) => /^backend\/tests\/integration\/.*\.integration\.test\.js$/.test(p));
if (!integration.length) {
  console.error('API changes require at least one changed backend/tests/integration/*.integration.test.js file.');
  console.error(`API changes: ${apiChanged.join(', ')}`);
  process.exit(1);
}
const evidence = /(better-sqlite3|127\.0\.0\.1|localhost|\.listen\(|fetch\(|http\.request|stub|Stub)/;
const evidenced = integration.filter((p) => evidence.test(readFileSync(p, 'utf8')));
if (!evidenced.length) {
  console.error('Integration test must exercise a real test database or an HTTP/downstream stub boundary.');
  process.exit(1);
}
console.log(`Contract Tests: PASS (${integration.join(', ')})`);
