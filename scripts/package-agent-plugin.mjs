#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isIP } from 'node:net';

const source = fileURLToPath(new URL('../plugins/restaurant-os/', import.meta.url));
const originToken = 'https://PLACEHOLDER_SITE_DOMAIN';
const manifestFiles = ['plugin.json', '.codex-plugin/plugin.json', 'mcp.json', '.mcp.json'];
const textFiles = ['README.md', 'skills/pedir-comida/SKILL.md'];

function fail(message) {
  throw new Error(message);
}

function validateOrigin(value) {
  // DECISÃO: só origens HTTPS públicas no pacote distribuível; desenvolvimento
  // local liga-se directamente pelo Inspector, sem gerar um pacote publicável.
  if (typeof value !== 'string' || !/^https:\/\/[a-z0-9.-]+(?::443)?\/?$/i.test(value) || /PLACEHOLDER_/i.test(value)) {
    fail('--base-url exige a origem HTTPS pública, sem credenciais, caminho, query ou fragmento.');
  }
  const url = new URL(value);
  const host = url.hostname;
  const labels = host.split('.');
  const reserved = /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host)
    || /(?:^|\.)example\.(com|org|net)$/.test(host);
  if (isIP(host) || labels.length < 2 || host.length > 253 || reserved || labels.some((label) =>
    label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  )) fail('--base-url deve indicar um domínio público real, sem IP ou domínio reservado.');
  return url.origin;
}

function validateOptions(values) {
  const origin = validateOrigin(values['base-url']);
  const name = values.name;
  if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
    || /placeholder/i.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(name)) {
    fail('--name exige um identificador estável em minúsculas e hífen, até 64 caracteres.');
  }
  const displayName = values['display-name'];
  if (typeof displayName !== 'string' || displayName.trim() !== displayName || !displayName
    || displayName.length > 80 || /[\u0000-\u001f\u007f<>]|PLACEHOLDER_/i.test(displayName)) {
    fail('--display-name exige o nome público final, até 80 caracteres e numa só linha.');
  }
  if (typeof values.output !== 'string' || !values.output.trim() || /[\u0000-\u001f]/.test(values.output)) {
    fail('--output exige a pasta de destino; o pacote será criado numa subpasta com o nome do plugin.');
  }
  return { origin, name, displayName, output: path.resolve(values.output) };
}

async function main() {
  const args = process.argv.slice(2);
  const supported = new Set(['--base-url', '--name', '--display-name', '--output']);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    if (!supported.has(args[index]) || seen.has(args[index]) || index + 1 >= args.length) {
      fail('Use uma vez cada opção: --base-url, --name, --display-name e --output.');
    }
    seen.add(args[index]);
  }
  const { values } = parseArgs({ args, options: Object.fromEntries([...supported].map((key) => [key.slice(2), { type: 'string' }])) });
  const { origin, name, displayName, output } = validateOptions(values);
  const files = new Map();

  for (const filename of manifestFiles) {
    const raw = await readFile(path.join(source, filename), 'utf8');
    const manifest = JSON.parse(raw.replaceAll(originToken, origin));
    if (filename.endsWith('plugin.json')) {
      manifest.name = name;
      const ui = filename === 'plugin.json' ? manifest.extensions['com.openai'].interface : manifest.interface;
      ui.displayName = displayName;
    }
    files.set(filename, JSON.stringify(manifest, null, 2) + '\n');
  }
  for (const filename of textFiles) files.set(filename, await readFile(path.join(source, filename), 'utf8'));
  for (const [filename, contents] of files) {
    if (/PLACEHOLDER_/i.test(contents)) fail(`O pacote ainda contém configuração por preencher em ${filename}.`);
  }

  // DECISÃO: lista fechada de ficheiros; nunca copiar .env, credenciais, outputs
  // ou ficheiros locais que tenham sido adicionados à pasta do modelo.
  await mkdir(output, { recursive: true });
  const destination = path.join(output, name);
  try {
    await mkdir(destination);
  } catch (error) {
    if (error.code === 'EEXIST') fail('A pasta deste plugin já existe. Escolha outra pasta de saída; nada foi substituído.');
    throw error;
  }
  for (const [filename, contents] of files) {
    const target = path.join(destination, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(`Pacote criado: ${destination}\nMCP: ${origin}/api/mcp\nO plugin não foi publicado, registado ou instalado. Valide a ligação HTTPS e siga o README.\n`);
}

main().catch((error) => {
  // Nunca imprimir os argumentos recebidos: uma configuração errada pode conter segredos.
  const message = error instanceof Error && !error.code ? error.message : 'Não foi possível criar o pacote. Verifique as opções, o modelo e as permissões da pasta.';
  process.stderr.write(`Erro: ${message}\n`);
  process.exitCode = 1;
});
