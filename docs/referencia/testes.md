# Pacotes, scripts, testes e CI

## 1. Responsabilidade e API

| Área | API/responsabilidade observada | Testes existentes |
|---|---|---|
| packages/core | Dinheiro (Cents/cents/conversões/formatMT/orderTotal), transition e tipos, schemas, importação/árvore de menu, getPaymentMode; entrada src/index.ts | 6 ficheiros __tests__; máquina/schemas herdados não equivalem às RPCs activas |
| packages/payments | PaymentProvider Redirect/Direct, Paysuite/Mock/Mpesa/MpesaSimulator/EmolaSimulator, assinatura/parsing/consulta, normalização MSISDN/códigos, conferência de extractos | 9 ficheiros; não provam API real Movitel ou conta do fornecedor |
| packages/receipt | PrintPayload/Op/layout, builders de vias/cozinha/cliente/turno/dia/senha, buildPrintDocument, encodeEscPos, renderPreview, sampleTicket | 4 ficheiros; diferenças locais preexistentes nos modelos/extras |
| packages/db | Tipos de BD, 2 migrations herdadas, gate de integração Supabase; fonte SQL canónica fica em supabase | 36 ficheiros tests; 353 declarações it/test por extracção, não total runtime |
| services/print-bridge | Config por loja, poll/claim, retries, TCP/Windows/série, servidor HTTP local/ledger, gaveta/visor, heartbeat/watchdog, layout/disco, SEA Windows | 18 ficheiros + 2 snapshots; simulação não valida hardware |
| apps/web/lib | Admin/analytics/attribution/agents/brand/cash/payments/POS/TV/auth/account/email/Google/monthly | 74 ficheiros de testes nas libs; não executados aqui |
| scripts | Setup, importação, backups/guard, reconciliação normalizada e pacote de agentes | 6 ficheiros de testes |

As 353 declarações de testes DB incluem **42 suspensas** por B-101 em cash.test.ts, payments.test.ts, referral.test.ts, stock.test.ts e tracking.test.ts. Existem suites cash-v2/stock-v2 activas; isso não prova substituição integral. Os testes de conta existentes cobrem token/hash com fixtures, não a cadeia de enumeração descrita em V-01.

Também há evidência positiva no código: client_sale_id único e bloqueio/reutilização da venda, preço do servidor, stock transaccional, total de pagamentos conferido e troco recalculado. A migration 1077 mantém esses passos; checkout/print_jobs/payments têm constraints próprias de idempotência. Os achados acima são específicos e não autorizam concluir que todo o domínio carece dessas protecções.

Core/payments/receipt têm `build` que apenas imprime TODO; main/types apontam a src/index.ts e Next transpila os três. Não produzem, por esse comando, um pacote compilado autónomo. O bridge tem tsc, bundle esbuild e SEA separados.

## 2. Todos os scripts do package.json raiz

| Script(s) | O que executa / limite |
|---|---|
| dev / build | turbo run dev / turbo run build |
| start | pnpm --filter web start |
| test / test:watch | vitest run / vitest |
| test:e2e | playwright test, configuração padrão |
| lint | turbo run lint + typecheck recursivo onde exista |
| db:migrate / db:seed | supabase db reset: reset da BD local, não actualização incremental |
| db:types | supabase gen types --local, redireccionado para packages/db/src/types.ts |
| setup:client / setup:check | setup-client.mjs; normal faz reset, --check valida configuração |
| client:limpar-demo | limpar-demonstracao.mjs; relatório por omissão, mutação com confirmação/projecto explícitos |
| menu:import | import-menu.ts; JSON normalizado, --dry-run, import_menu no modo de escrita |
| bridge:dev | Serviço completo com env em sintaxe POSIX; não portátil em Windows padrão |
| clean | turbo clean + rm -rf node_modules; sintaxe POSIX |
| equipa:criar | criar-equipa.mjs; lê ficheiro de equipa, cria acesso/PIN, suporta dry-run |

Versões declaradas: pnpm **9.0.0**; Node **>=22 e <25**. Workspaces: apps/*, packages/*, services/*.

Bridge: lint/test/test:watch, dev/bridge:dev (watch do serviço), dev:sim (demonstração local), build (tsc), build:bundle (esbuild), build:sea (PowerShell). Web: dev/build/start/lint/typecheck. Os três pacotes de domínio têm exports de fonte e build placeholder, conforme acima.

## 3. Scripts fora do menu principal

- import-hawsmash-1.ts: dry-run lê origem; --apply escreve destino; guarda prometida ausente (R-04).
- backup.mjs: pg_dump, pasta/dry-run, retenção 30 dias; transporte externo não implementado.
- check-placeholders.mjs: consulta stores/delivery_zones/staff_profiles; manual, não ligado ao build.
- reconcile-payment-statement.ts: ficheiros JSON locais, não consulta banco/fornecedor nem confirma pagamento.
- package-agent-plugin.mjs: gera pacote por instalação, não publica.
- smoke-public-mcp.mjs: ensaio de protocolo/leitura contra URL fornecido.
- agent-rpc-simulator.ts, orders-rpc-simulator.ts, analysis-rpc-simulator.ts, payment-rpc-simulator.ts: simuladores locais para suites específicas.
- setup-client/validate-config: ainda admite apenas manual/mock/paysuite na validação do provider; comentário sobre cron sem protecção não descreve reconcile actual.

## 4. Configurações de teste, CI e hosting

| Configuração | Âmbito efectivo |
|---|---|
| vitest.config.ts | Apenas **/__tests__/**/*.test.ts; exclui **/tests/** e worktrees .kilo |
| packages/db/vitest.config.ts | tests/**/*.test.ts, serialização e globalSetup que protege de impressora real; testes escrevem dados |
| playwright.config.ts | e2e padrão, worker único, build/start localhost:3100; exclui as quatro suites abaixo |
| playwright.agents.config.ts | Web 3017/RPC 3018; agents.spec |
| playwright.orders.config.ts | Web 3019/RPC 3020; orders-pagination.spec |
| playwright.analysis.config.ts | Deriva da de pedidos, muda simulador/testMatch para análise |
| playwright.payments.config.ts | Web 3031/RPC 3032; payment-methods.spec |
| .github/workflows/ci.yml | Push dev/main, PR main; dependências frozen, Supabase local/reset, gate DB separado, lint/unit/build/Playwright padrão |
| turbo.json | Build depende de ^build; outputs .next (não dist/build bridge); globalEnv desactualizado; ficheiros env locais como dependência |
| railway.json | Railpack, pnpm build/start, health /api/health, timeout 300, restart ON_FAILURE até 5; sem scheduler |

Não se verificou execução recente do CI nem configuração remota das branches. Os estados documentados em corridas anteriores são evidência datada, não medições renovadas por esta auditoria.

## Verificação documental

`node scripts/docs/check-links.mjs` verifica ligações e referências a ficheiros; `node scripts/docs/check-schema.mjs` verifica nomes de objectos; `node scripts/docs/check-spec.mjs` verifica a transferência da spec. `node scripts/docs/schema-catalog.mjs --check` compara catálogos gerados.

A [validação desta revisão](../validation/revisao-documental-2026-09-26.md) distingue comandos executados, configuração sintética e limites. Testes unitários não substituem RLS, staging ou hardware.
