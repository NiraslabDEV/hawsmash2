#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

// Usa a mesma versão fixada do SDK que o servidor web.
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const { values } = parseArgs({ options: { url: { type: 'string' }, selection: { type: 'string' } } });
if (!values.url) throw new Error('Indica --url com o endpoint /api/mcp; --selection aceita um ficheiro JSON de escolhas, opcional.');
const url = new URL(values.url);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/mcp') throw new Error('Endpoint MCP inválido.');
if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('HTTP é permitido apenas para ensaio local.');

const client = new Client({ name: 'restaurant-os-verificacao', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(url));
  const { tools } = await client.listTools();
  const expected = ['list_stores', 'get_menu', 'quote_order', 'prepare_checkout'];
  if (tools.length !== expected.length || !expected.every((name) => tools.some((tool) => tool.name === name))) throw new Error('Lista de ferramentas inesperada.');
  const result = await client.callTool({ name: 'list_stores', arguments: {} });
  if (result.isError || !result.structuredContent) throw new Error('A consulta de lojas falhou.');
  if (values.selection) {
    const selection = JSON.parse(await readFile(values.selection, 'utf8'));
    const quote = await client.callTool({ name: 'quote_order', arguments: selection });
    const prepared = await client.callTool({ name: 'prepare_checkout', arguments: selection });
    if (quote.isError || prepared.isError || !prepared.structuredContent) throw new Error('A preparação da selecção falhou.');
    const review = new URL(prepared.structuredContent.checkoutUrl);
    if (review.origin !== url.origin || review.pathname !== '/pedido-assistido' || !review.hash) throw new Error('Link de revisão fora do contrato.');
  }
  process.stdout.write('MCP verificado com o cliente oficial: initialize, tools/list e consultas públicas' + (values.selection ? ', cálculo e preparação do checkout' : '') + '. Nenhuma encomenda ou pagamento iniciado.\n');
} finally { await client.close(); }
