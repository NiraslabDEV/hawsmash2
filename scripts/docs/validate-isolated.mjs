#!/usr/bin/env node
/**
 * Valida documentação/código numa cópia temporária sem segredos da instalação.
 * Nunca executa lint/Vite no checkout, SQL, deploy ou instalação pela rede.
 * Uso: node scripts/docs/validate-isolated.mjs [--prepare-only]
 * A cópia e os logs ficam no temporário para conferência; não apaga ficheiros.
 */
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--prepare-only') || args.length > 1) {
  process.stderr.write('Uso: node scripts/docs/validate-isolated.mjs [--prepare-only]\n');
  process.exit(2);
}
const prepareOnly = args.includes('--prepare-only');
const sourceRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const excludedDirectories = new Set([
  '.git', 'node_modules', '.next', '.turbo', '.vercel', '.kilo', '.worktrees',
  'dist', 'build', 'coverage', 'output', 'comercial', 'test-results', 'playwright-report',
  '.supabase', '.temp', '.cache',
]);

/** Só nomes: aplica-se antes de lstat/read/copy de qualquer candidato. */
function allowed(relative) {
  const parts = relative.replaceAll('\\', '/').split('/');
  if (!relative || path.isAbsolute(relative) || parts.some((part) => part === '..')) return false;
  if (parts.some((part) => excludedDirectories.has(part.toLowerCase()))) return false;
  const name = parts.at(-1).toLowerCase();
  if (name.startsWith('credenciais')) return false;
  if (name.startsWith('.env') && name !== '.env.example') return false;
  if (['.npmrc', '.pnpmfile.cjs', '.app-build-version'].includes(name)) return false;
  return !/\.(?:log|tsbuildinfo|dump|bak|pem|key|pfx|p12)$/i.test(name);
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}

/** Não propaga credenciais, NODE_OPTIONS nem configuração da instalação. */
function cleanEnvironment() {
  const result = {};
  const keys = [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC',
    'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS', 'OS', 'PNPM_HOME', 'LANG', 'LC_ALL',
  ];
  for (const key of keys) if (process.env[key] !== undefined) result[key] = process.env[key];
  return {
    ...result,
    CI: '1', NO_COLOR: '1', NEXT_TELEMETRY_DISABLED: '1', TURBO_TELEMETRY_DISABLED: '1',
    COREPACK_ENABLE_NETWORK: '0', npm_config_offline: 'true',
  };
}

const baseEnv = cleanEnvironment();
const listing = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  cwd: sourceRoot, env: baseEnv, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
if (listing.status !== 0) throw new Error('Não foi possível inventariar os nomes versionados/não ignorados.');
const candidates = [...new Set(listing.stdout.split('\0').filter(allowed))].sort();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'restaurant-docs-check-'));
if (temporaryRoot === sourceRoot || isInside(sourceRoot, temporaryRoot)) {
  throw new Error('O temporário tem de ficar fora do checkout.');
}
const checkout = path.join(temporaryRoot, 'checkout');
mkdirSync(checkout);
const logs = path.join(temporaryRoot, 'logs');
mkdirSync(logs);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const protectedFiles = new Map();
const copied = [];
const omitted = [];

function protectedSource(relative) {
  // A documentação pode continuar a ser redigida em paralelo; o código/SQL não.
  if (/\.md$/i.test(relative)) return false;
  return /^(?:apps|packages|services|config|supabase)\//.test(relative)
    || /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|railway\.json|tsconfig[^/]*\.json|vitest\.config\.ts|playwright[^/]*\.ts)$/.test(relative)
    || (relative.startsWith('scripts/') && !relative.startsWith('scripts/docs/'));
}

for (const relative of candidates) {
  const origin = path.resolve(sourceRoot, relative);
  if (!isInside(sourceRoot, origin)) throw new Error('Caminho de origem fora do checkout.');
  if (!existsSync(origin)) { omitted.push({ path: relative, reason: 'removed_in_worktree' }); continue; }
  const metadata = lstatSync(origin);
  // Não seguir links para segredos ou fontes fora da cópia.
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    omitted.push({ path: relative, reason: 'not_regular_file' }); continue;
  }
  const resolvedOrigin = realpathSync(origin);
  if (!isInside(sourceRoot, resolvedOrigin)) throw new Error('Origem resolvida fora do checkout.');
  if (!allowed(path.relative(sourceRoot, resolvedOrigin))) {
    omitted.push({ path: relative, reason: 'resolved_path_excluded' }); continue;
  }
  const bytes = readFileSync(origin);
  const destination = path.resolve(checkout, relative);
  if (!isInside(checkout, destination)) throw new Error('Destino fora do temporário.');
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { flag: 'wx' });
  copied.push(relative);
  if (protectedSource(relative)) protectedFiles.set(relative, hash(bytes));
}

// Ignora configurações npm de utilizador/máquina; a store offline usa a localização padrão do pnpm.
const emptyConfig = path.join(temporaryRoot, 'empty.npmrc');
writeFileSync(emptyConfig, '', { flag: 'wx' });
// A suite inclui servidores TCP/HTTP locais. Não permite sockets Node para serviços externos.
const networkGuard = path.join(temporaryRoot, 'loopback-only.cjs');
writeFileSync(networkGuard, `
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const input = Array.isArray(args[0]) ? args[0] : args;
  const options = input[0];
  const isPipe = typeof options === 'string' || (options && typeof options === 'object' && options.path);
  const host = options && typeof options === 'object' ? options.host : input[1];
  if (!isPipe && typeof host === 'string' && !/^(localhost|127(?:\\.[0-9]{1,3}){3}|::1|\\[::1\\])$/i.test(host)) {
    throw new Error('ISOLATED_NETWORK_BLOCKED: só são permitidas ligações locais.');
  }
  return connect.apply(this, args);
};
`, { flag: 'wx' });
const env = {
  ...baseEnv, npm_config_userconfig: emptyConfig, npm_config_globalconfig: emptyConfig,
  NODE_OPTIONS: `--require="${networkGuard.replaceAll('\\', '/')}"`,
  // Sem git nesta cópia: versão determinística e sintética para o next lint.
  RAILWAY_GIT_COMMIT_SHA: 'PLACEHOLDER_ISOLATED_VALIDATION',
};
const stages = [];

function runStage(name, command) {
  process.stdout.write(`[isolated] ${name}\n`);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  // Comandos fixos: nenhum caminho/valor externo é interpolado no texto do shell.
  const child = process.platform === 'win32'
    ? spawnSync(env.ComSpec || env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', command], {
      cwd: checkout, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000,
    })
    : spawnSync('/bin/sh', ['-c', command], {
      cwd: checkout, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000,
    });
  const output = `${child.stdout || ''}${child.stderr || ''}`;
  const logFile = path.join(logs, `${name}.log`);
  writeFileSync(logFile, output, { flag: 'wx' });
  const summary = output.split(/\r?\n/).filter((line) =>
    /(?:Test Files|Tests\s+\d|Duration\s|Tasks:|Failed Tests|ERR_PNPM|error TS\d|Error:|FAIL\s)/.test(line),
  ).map((line) => line.replace(/\u001b\[[0-9;]*m/g, '')).slice(-30);
  const result = {
    name, command, startedAt, durationMs: Date.now() - started,
    exitCode: child.status, signal: child.signal, errorCode: child.error?.code || null,
    log: logFile, summary,
  };
  stages.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.exitCode === 0;
}

process.stdout.write(`[isolated] ${copied.length} ficheiros copiados; ${protectedFiles.size} hashes protegidos. Temporário: ${temporaryRoot}\n`);
const installed = runStage('install', 'pnpm install --offline --frozen-lockfile --ignore-scripts');
if (installed && !prepareOnly) {
  runStage('lint', 'pnpm lint');
  // Corre também se lint falhar: documenta ambos, sem corrigir o checkout.
  runStage('test', 'pnpm test');
}

const changed = [];
for (const [relative, expected] of protectedFiles) {
  const origin = path.resolve(sourceRoot, relative);
  if (!existsSync(origin) || !lstatSync(origin).isFile() || lstatSync(origin).isSymbolicLink()
    || !isInside(sourceRoot, realpathSync(origin)) || !allowed(path.relative(sourceRoot, realpathSync(origin)))
    || hash(readFileSync(origin)) !== expected) {
    changed.push(relative);
  }
}
const migrationCount = [...protectedFiles.keys()].filter((relative) => relative.startsWith('supabase/migrations/') && relative.endsWith('.sql')).length;
const report = {
  sourceRoot, checkout, prepareOnly, createdAt: new Date().toISOString(),
  filesCopied: copied.length, filesOmitted: omitted.length, protectedFiles: protectedFiles.size,
  migrationsHashed: migrationCount, originalSourcesUnchanged: changed.length === 0, changed,
  stages,
  limitations: [
    'Sem BD, E2E, build/deploy, hardware ou segredos da instalação.',
    'Dependências instaladas apenas da cache offline, sem lifecycle scripts.',
    'Sockets Node limitados a loopback; não equivale a uma sandbox do sistema operativo.',
    'O snapshot inclui ficheiros permitidos não versionados e alterações locais existentes.',
  ],
};
writeFileSync(path.join(temporaryRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
writeFileSync(path.join(temporaryRoot, 'manifest.json'), JSON.stringify({ copied, omitted, hashes: Object.fromEntries(protectedFiles) }, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(`[isolated] Relatório: ${path.join(temporaryRoot, 'report.json')}\n`);
process.stdout.write(`[isolated] Fontes/migrations originais intactas: ${changed.length === 0}; migrations: ${migrationCount}.\n`);
process.exitCode = installed && changed.length === 0 && stages.every((stage) => stage.exitCode === 0) ? 0 : 1;
