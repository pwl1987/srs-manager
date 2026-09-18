import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dir = path.join(root, 'docs/product/ui-v3-reference/phase08');
const metrics = JSON.parse(fs.readFileSync(path.join(dir, 'metrics.json'), 'utf8'));

const required = new Set([
  '1920x1080-onair', '1920x1080-prep', '1920x1080-preview',
  '1920x1080-incident', '1920x1080-closing', '1366x768-onair',
  '2560x1440-onair', '3840x2160-onair'
]);
const seen = new Set(metrics.map(item => item.name));
for (const name of required) {
  if (!seen.has(name)) throw new Error(`Missing Phase 08 layout case: ${name}`);
  const png = path.join(dir, `${name}.png`);
  if (!fs.existsSync(png) || fs.statSync(png).size < 1024) {
    throw new Error(`Missing/empty Phase 08 screenshot: ${name}.png`);
  }
}

const regionNames = ['global', 'session', 'main', 'input', 'program', 'outputs', 'route', 'dock'];
for (const item of metrics) {
  const { innerW, innerH, docW, docH, regions } = item.metrics;
  if (docW !== innerW || docH !== innerH) throw new Error(`Root overflow: ${item.name}`);
  if (regions.root.scrollW !== regions.root.clientW || regions.root.scrollH !== regions.root.clientH) {
    throw new Error(`Root scrolling is forbidden: ${item.name}`);
  }
  for (const key of regionNames) {
    const region = regions[key];
    if (!region || region.w <= 0 || region.h <= 0) throw new Error(`Missing region ${key}: ${item.name}`);
  }
  if (regions.program.w <= regions.input.w) throw new Error(`Program is not the visual focus: ${item.name}`);
  if (regions.outputs.w <= innerW * 0.30) throw new Error(`Output Rack too narrow: ${item.name}`);
}

const compact = metrics.find(item => item.name === '1366x768-onair');
if (!compact) throw new Error('Missing compact 1366 gate');
console.log(`Phase 08 layout gate PASS (${metrics.length} cases)`);
console.log(`1366 Program internal scroll: ${compact.metrics.regions.program.scrollH > compact.metrics.regions.program.clientH ? 'expected compact degradation' : 'not needed'}`);
