import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const forbidden = (name) => name.split(/[\\/]/).some((part) =>
  ['node_modules', '.git', '.next', '.turbo', '.kilo', 'comercial', 'output', 'dist', 'build'].includes(part) ||
  /^CREDENCIAIS/i.test(part) || (/^\.env(?:\.|$)/.test(part) && part !== '.env.example'));

export function repositoryFiles(root) {
  return [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8',
  }).split('\0').filter(Boolean))].filter((name) => !forbidden(name));
}
export async function markdownFiles(root) {
  const files = repositoryFiles(root).filter((name) => name.endsWith('.md'));
  const present = await Promise.all(files.map(async (name) => {
    try { return (await fs.stat(path.join(root, name))).isFile() ? name : null; } catch { return null; }
  }));
  return present.filter(Boolean).sort();
}
export const withoutFences = (text) => text.replace(/^([ \t]*)(```+|~~~+)[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, '');
export function relativeLinks(text) {
  const found = [];
  const pattern = /\]\(/g;
  let match;
  while ((match = pattern.exec(text))) {
    let end = pattern.lastIndex, depth = 1;
    for (; end < text.length && depth; end++) {
      if (text[end] === '\\') { end++; continue; }
      if (text[end] === '(') depth++;
      if (text[end] === ')') depth--;
    }
    if (depth) continue;
    let target = text.slice(pattern.lastIndex, end - 1).trim();
    if (target.startsWith('<')) target = target.slice(1, target.indexOf('>'));
    else target = target.replace(/\s+["'][\s\S]*$/, '');
    found.push({ target, index: match.index });
    pattern.lastIndex = end;
  }
  for (const match of text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)) {
    found.push({ target: match[1], index: match.index });
  }
  return found;
}
export function anchors(text) {
  const result = new Set(), seen = new Map();
  for (const match of withoutFences(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = seen.get(slug) || 0; seen.set(slug, count + 1);
    result.add(count ? slug + '-' + count : slug);
  }
  for (const match of text.matchAll(/<(?:a|[^ >]+)[^>]*(?:id|name)=["']([^"']+)["']/g)) result.add(match[1]);
  return result;
}
