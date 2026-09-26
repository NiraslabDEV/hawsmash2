import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { repositoryRoot } from './lib.mjs';

const root = process.argv.includes('--root') ? path.resolve(process.argv[process.argv.indexOf('--root') + 1]) : repositoryRoot;
const manifest = JSON.parse(await fs.readFile(path.join(root, 'scripts/docs/spec-preservation.json'), 'utf8'));
function normalize(text) {
  text = text.replace(/(?<=\]\()([^\s)]+)(?=\))/g, 'DESTINO');
  for (const [before, after] of Object.entries(manifest.pathMoves)) text = text.replaceAll(before, after);
  return text.replace(/\s+/g, ' ').trim();
}
const hash = (text) => createHash('sha256').update(normalize(text)).digest('hex');
const cache = new Map();
async function read(file) {
  if (!cache.has(file)) cache.set(file, (await fs.readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n'));
  return cache.get(file);
}
const failures = [];
for (const block of manifest.blocks) {
  const hashes = new Set((await read(block.destination)).split(/\n\s*\n/).filter((x) => x.trim()).map(hash));
  if (!hashes.has(block.sha256)) failures.push('§' + block.section + ', bloco ' + block.block + ' → ' + block.destination);
}
for (const item of manifest.immutable) {
  let text = await read(item.file);
  if (item.section !== undefined) {
    const start = new RegExp('^## ' + item.section + '\\. .+$', 'm').exec(text);
    if (!start) { failures.push(item.file + ' sem §' + item.section); continue; }
    text = text.slice(start.index);
    const end = /^## \d+\. .+$/m.exec(text.slice(start[0].length));
    if (end) text = text.slice(0, start[0].length + end.index);
  }
  if (hash(text.trim()) !== item.sha256) failures.push(item.file + (item.section !== undefined ? ' §' + item.section : '') + ': decisão alterada');
}
if (failures.length) {
  console.error('Falhas de preservação:\n' + failures.join('\n')); process.exitCode = 1;
} else {
  console.log('Preservação: ' + manifest.blocks.length + ' blocos; ' + manifest.immutable.length + ' decisões/ADRs intactos; ' + manifest.corrections.length + ' redacção de contactos privados registada.');
}
