import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:null).filter(Boolean));
for (const k of ['base','head','candidate-backend','candidate-frontend','baseline-backend','baseline-frontend']) if (!args[k]) throw new Error(`missing --${k}`);
const norm = (p) => p.replaceAll('\\','/');
function reportLines(file) {
  const raw = JSON.parse(readFileSync(file,'utf8'));
  const out = new Map();
  for (const [filePath, data] of Object.entries(raw)) {
    const n = norm(filePath); const bi=n.lastIndexOf('/backend/'), fi=n.lastIndexOf('/frontend/');
    let rel = bi>=0 ? `backend/${n.slice(bi+9)}` : fi>=0 ? `frontend/${n.slice(fi+10)}` : null;
    if (!rel) continue;
    const lines = new Map();
    for (const [id, loc] of Object.entries(data.statementMap || {})) {
      const line=loc.start.line, count=Number((data.s||{})[id]||0);
      lines.set(line, Math.max(lines.get(line)||0,count));
    }
    out.set(rel, lines);
  }
  return out;
}
function merge(...maps) { const out=new Map(); for (const m of maps) for (const [f,l] of m) out.set(f,l); return out; }
function pct(map) { let total=0,covered=0; for (const lines of map.values()) for (const c of lines.values()) { total++; if(c>0) covered++; } return {total,covered,pct:total?covered*100/total:100}; }
function diffLines() {
  const text=execFileSync('git',['diff','--unified=0','--no-color',`${args.base}...${args.head}`,'--','backend','frontend/src'],{encoding:'utf8'});
  const changed=new Map(); let file=null;
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ b/')) { file=line.slice(6); if (/^backend\/.*\.js$/.test(file) && !file.includes('/tests/') || /^frontend\/src\/.*\.(js|jsx)$/.test(file) && !/\.test\./.test(file)) changed.set(file,new Set()); }
    else if (file && changed.has(file) && line.startsWith('@@')) {
      const m=line.match(/\+(\d+)(?:,(\d+))?/); if (!m) continue; const start=Number(m[1]), len=m[2]===undefined?1:Number(m[2]);
      for(let n=start;n<start+len;n++) changed.get(file).add(n);
    }
  }
  return changed;
}
const candidate=merge(reportLines(args['candidate-backend']),reportLines(args['candidate-frontend']));
const baseline=merge(reportLines(args['baseline-backend']),reportLines(args['baseline-frontend']));
const changed=diffLines(); let diffTotal=0,diffCovered=0; const missing=[];
for (const [file,lines] of changed) {
  const coverage=candidate.get(file); if(!coverage){ missing.push(file); continue; }
  for(const line of lines) if(coverage.has(line)){ diffTotal++; if(coverage.get(line)>0) diffCovered++; }
}
if(missing.length){ console.error(`Coverage report missing changed code files: ${missing.join(', ')}`); process.exit(1); }
const diffPct=diffTotal?diffCovered*100/diffTotal:100; const c=pct(candidate), b=pct(baseline);
console.log(`Diff line coverage: ${diffPct.toFixed(2)}% (${diffCovered}/${diffTotal})`);
console.log(`Overall line coverage: candidate ${c.pct.toFixed(2)}% vs baseline ${b.pct.toFixed(2)}%`);
if(diffPct < 85){ console.error('Delta coverage gate failed: changed executable lines must be >= 85%.'); process.exit(1); }
if(c.pct < b.pct - 0.5){ console.error('Coverage regression gate failed: overall line coverage dropped by more than 0.5 percentage points.'); process.exit(1); }
console.log('Delta Coverage: PASS');
