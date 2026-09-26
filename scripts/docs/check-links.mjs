import fs from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, markdownFiles, repositoryFiles, forbidden, relativeLinks, anchors, withoutFences } from './lib.mjs';

const root = process.argv.includes('--root') ? path.resolve(process.argv[process.argv.indexOf('--root') + 1]) : repositoryRoot;
let exceptions = [];
try { exceptions = JSON.parse(await fs.readFile(path.join(root, 'scripts/docs/link-exceptions.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const files = await markdownFiles(root), allFiles = repositoryFiles(root);
const failures = [], used = new Set(), cache = new Map();
let links = 0, paths = 0;
function allowed(file, target, kind) {
  const index = exceptions.findIndex((x) => x.file === file && x.target === target && x.kind === kind && x.reason?.trim());
  if (index < 0) return false;
  used.add(index); return true;
}
async function exists(name) { try { await fs.stat(name); return true; } catch { return false; } }
async function read(name) {
  if (!cache.has(name)) cache.set(name, await fs.readFile(name, 'utf8'));
  return cache.get(name);
}
for (const file of files) {
  const content = await read(path.join(root, file));
  for (const { target, index } of relativeLinks(content)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    links++;
    if (allowed(file, target, 'link')) continue;
    let [name, fragment] = target.split('#');
    try { name = decodeURIComponent(name.split('?')[0]); fragment = fragment && decodeURIComponent(fragment); } catch { /* report target as written */ }
    const full = name ? path.resolve(path.dirname(path.join(root, file)), name) : path.join(root, file);
    let problem;
    if (!(await exists(full))) problem = 'destino inexistente';
    else if (fragment && !forbidden(path.relative(root, full))) {
      if (/^L\d+(?:-L?\d+)?$/.test(fragment)) {
        const max = Number(fragment.match(/\d+$/)[0]);
        if (max > (await read(full)).split('\n').length) problem = 'linha fora do ficheiro';
      } else if (full.endsWith('.md') && !anchors(await read(full)).has(fragment)) problem = 'âncora inexistente';
    }
    if (problem) failures.push({ file, line: content.slice(0, index).split('\n').length, kind: 'link', target, problem });
  }
  if (/^docs\/(?:legacy|engine)\//.test(file)) continue;
  const plain = withoutFences(content);
  for (const match of plain.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) {
    const target = match[1].trim();
    // Commands, identifiers, SQL signatures, URLs, package IDs and routes are not file paths.
    if (/^(?:pnpm |npm |node |git |npx |supabase |POST |GET |PATCH |DELETE |https?:|@|[a-z]+:\/\/|[A-Z_]+=[^\s]+\s)/.test(target)) continue;
    if (!/(?:^|\/)[^ /]+\.(?:md|html|tsx?|m?js|cjs|json|ya?ml|sql|ps1|b64|png|svg|test\.ts)(?:$|[ :#§])/.test(target) &&
        !/^(?:apps|packages|services|scripts|supabase|config|docs|public|data|\.github)\//.test(target)) continue;
    if (/^(?:select|create|update|import|from|export) /i.test(target)) continue;
    paths++;
    if (allowed(file, target, 'path')) continue;
    const name = target.replace(/(?:[:#]\d+(?:-\d+)?| §.*| →.*|:\d+.*)$/, '').replace(/^\//, '').replace(/\/$/, '');
    const candidates = [path.resolve(root, name), path.resolve(path.dirname(path.join(root, file)), name)];
    // Documents often state paths relative to the web app; verify the actual destination.
    for (const base of ['apps/web', 'apps/web/app', 'apps/web/app/(public)', 'services/print-bridge']) {
      candidates.push(path.resolve(root, base, name));
    }
    if (!name.includes('/')) {
      for (const other of allFiles) {
        const base = path.posix.basename(other);
        if (base.toLowerCase() === name.toLowerCase() || (/^\d{4}_.+\.sql$/.test(name) && base.endsWith('_' + name))) {
          candidates.push(path.resolve(root, other));
        }
      }
    }
    // A wildcard is valid only if it matches at least one permitted, existing file.
    if (name.includes('*')) {
      const pattern = new RegExp('^' + name.replace(/[.+^$(){}|[\]\\]/g, '\\$&').replaceAll('*', '.*') + '$');
      for (const other of allFiles) if (pattern.test(other)) candidates.push(path.resolve(root, other));
    }
    if (!(await Promise.all(candidates.map(exists))).some(Boolean)) failures.push({ file, kind: 'path', target, problem: 'caminho citado inexistente' });
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ files: files.length, links, paths, exceptionsUsed: used.size, failures }, null, 2));
else {
  for (const f of failures) console.error(f.file + (f.line ? ':' + f.line : '') + ' [' + f.kind + '] ' + f.target + ' — ' + f.problem);
  console.log(files.length + ' Markdown; ' + links + ' links; ' + paths + ' caminhos; ' + used.size + ' excepções justificadas; ' + failures.length + ' falhas.');
}
if (failures.length) process.exitCode = 1;
