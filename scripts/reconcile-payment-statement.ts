import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reconcilePaymentStatement } from '../packages/payments/src/statement';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Uso: pnpm exec tsx scripts/reconcile-payment-statement.ts --input ficheiro.json --output relatorio.json\nSó lê ficheiros normalizados. Nunca consulta o M-Pesa nem altera pagamentos.\n');
    return;
  }
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output' || !args[1] || !args[3]) throw new Error('Usa --input ficheiro.json --output relatorio.json.');
  const source = resolve(args[1]); const destination = resolve(args[3]);
  if (source === destination) throw new Error('Entrada e relatório têm de ser ficheiros diferentes.');
  const metadata = await stat(source);
  if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024) throw new Error('Entrada inválida ou maior que 32 MiB.');
  const report = reconcilePaymentStatement(JSON.parse(await readFile(source, 'utf8')));
  // DECISÃO: nunca substituir um extracto ou uma conferência anterior. O operador
  // escolhe outro nome; repetir a análise continua sem qualquer efeito financeiro.
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${report.status === 'matched' ? 'Referências conferidas' : 'Revisão necessária'}: ${report.matchedCount} correspondências, ${report.issues.length} ocorrências. Relatório local criado.\n`);
  if (report.issues.length) process.exitCode = 2;
}

void main().catch(() => {
  // O erro de parsing pode conter dados do extracto. Não o copiar para logs.
  process.stderr.write('Não foi possível conferir o ficheiro. Verifica o contrato, o intervalo, a loja e se o destino já existe. Nenhum pagamento foi alterado.\n');
  process.exitCode = 1;
});
