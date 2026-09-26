# Robustez e invariantes transversais

Estes são requisitos preservados, não comprovativos de configuração ou ensaio. Estado verificável em [testes](../referencia/testes.md), [crons](../referencia/crons.md) e [runbook](../operacao/runbook.md). Os alertas cobrem parte da lista; backup externo ainda não implementa transporte e PITR não foi inspeccionado. `pnpm test` exclui BD. Migrations físicas usam timestamp + número + assunto.

## 11. ROBUSTEZ — o programa completo

> Esta secção existe porque o sistema passa a ser o coração de duas lojas. Cada item é **verificável**.

### 11.1 Nunca perder uma venda
Ordem de degradação, do melhor para o pior — e o POS desce sozinho:
`online + impressora` → `online, impressora em baixo` (venda grava, talão fica em fila, avisa) →
`offline, impressora na LAN` (venda em IndexedDB, papel sai) → `offline, sem impressora`
(venda em IndexedDB, ecrã mostra o número e o total; procedimento em papel treinado).

### 11.2 Idempotência (lista fechada)
`orders.client_sale_id unique` · `payments.idempotency_key unique` · `print_jobs unique(order_id,station,kind,reprint_seq)` ·
webhook Paysuite com HMAC + `on conflict do nothing` · `create_order` com rate-limit por telefone (6/hora, herdado do 1.0).

### 11.3 Realtime que não mente
Lição do HAWSMASH 1.0 (corrida real em produção): **o evento de realtime nunca constrói estado** — só dispara
`refetch()` da fonte. Se o realtime cair, um **polling de 15 s** assume. Pedido sem itens no ecrã é bug de
arquitectura, não azar.

### 11.4 Testes que travam o deploy
- `packages/core`: money, order-machine, schemas (herdado, já verde).
- `packages/db/tests/rls.test.ts`: **isolamento entre lojas** — utilizador da Matola a tentar ler/escrever
  Maputo tem de falhar. **Gate de CI.**
- POS: teste de idempotência (mesma `client_sale_id` 2× → 1 pedido), troco, stock esgotado, anulação.
- Playwright: venda de balcão ponta a ponta com impressora simulada; checkout online ponta a ponta.
- `pnpm lint && pnpm test` verdes é **condição de merge**. Sem excepções.

### 11.5 Monitorização e alertas (é isto que substitui o telefonema)
- `devices (id, store_id, kind, label, app_version, last_seen_at)` — `kind ∈ ('pos','bridge','kds','tv')`,
  heartbeat 60 s.
- Painel **Sistema**: semáforo por loja — POS, impressora, bridge, internet, último pedido, fila de impressão.
- **Alertas automáticos** (email + WhatsApp deep link) quando: dispositivo silencioso > 5 min em horário de loja ·
  `print_jobs` falhado 3× · pedido pago sem comanda impressa > 2 min · loja sem nenhuma venda há > 90 min em
  horário de pico · erro 5xx repetido · stock crítico.
- **Digest diário** ao dono: vendas por loja, fecho de caixa, incidentes.
- **Resumo mensal** no dia 1 (1096, `/api/cron/monthly`): vendas do mês por loja face ao anterior, mais
  vendidos e, no mesmo email, **nota e avaliações de cada loja no Google** (Places API; o Place ID é da
  loja, na aba Lojas). Métricas do Perfil de Empresa (visualizações, chamadas, direcções) esperam pela
  aprovação do Google — [`BLOQUEIOS.md` B-114](../../BLOQUEIOS.md).

### 11.5.1 Preparação para operações de maior volume

O reforço comum para novas instalações vive em [`docs/planos/volume.md`](../planos/volume.md).
Prioridade: remover cortes de paginação, consultar pagamentos com a conta da loja correcta e
conferir extractos por referência/centavos. A conferência de ficheiros é apenas de leitura;
não é uma confirmação do fornecedor e nunca altera pagamentos. Carga, failover, automações
de marketing e activação real têm critérios próprios; existir código não equivale a capacidade medida.

### 11.6 Dados: backups e restauro
- Supabase **Pro** com PITR no projecto de produção.
- `pg_dump` nocturno para armazenamento externo (retenção 30 dias) via cron.
- **Teste de restauro mensal**, com data e resultado registados em `docs/operacao/runbook.md`. Backup não testado não é backup.
- Exportação de dados (CSV) disponível ao cliente a qualquer momento — é compromisso da proposta.

### 11.7 Disciplina de mudança
Migrations **forward-only** e idempotentes, uma por assunto, nomeadas `1NNN_assunto.sql`. Nada de SQL manual em
produção. Alteração que toque em dinheiro, RLS ou estado de pedido exige teste **antes** do código (ver `AGENTS.md`).

### 11.8 Fuso horário
Tudo gravado em **UTC**; apresentado em **Africa/Maputo**. Horários de loja e relatórios calculados no fuso da
loja. (O 1.0 teve um bug real de caixa por causa disto — não repetir.)

### 11.9 Degradação de pagamento

**e-Mola directo preparado por loja:** `stores.emola_provider='emola'` reserva a
integração Movitel sem Paysuite; API e BD recusam iniciar até existir contrato e
adaptador real. `emola_sim` ensaia o percurso em desenvolvimento/teste, sem rede
ou dinheiro, e é recusado em produção. M-Pesa directo mantém configuração própria.
O motor preserva gateways legados para outras instalações. Checkout, confirmação
e reconciliação escolhem o fornecedor pelo método e loja da encomenda gravada.
Configuração, limites e ensaios em [`docs/modulos/pagamentos.md`](../modulos/pagamentos.md).

Se o gateway falhar (API em baixo, chave inválida, credenciais por preencher), o checkout **não morre**: cai
automaticamente no fluxo **manual por comprovativo** (herdado do 1.0) e avisa o painel. Uma loja nunca deixa
de receber encomendas por causa do gateway.

**No M-Pesa directo há uma regra a mais, e é a que mais custa errar:** *"não sei" nunca vira "não pagou"*.
Tempo esgotado, erro do M-Pesa, rede em baixo ou código desconhecido deixam o pedido **pendente** — nunca
falhado. O cliente pode ter digitado o PIN e o dinheiro ter saído; quem decide é o M-Pesa, quando lhe
perguntarmos (verificação activa no ecrã de espera, e cron de reconciliação).

O checkout digital persiste `clientCheckoutId` e reclama uma única iniciação na BD
(1047). A referência enviada ao fornecedor conserva-se para consultas, mesmo após
falha definitiva. Repetir o envio recupera a mesma encomenda; uma nova tentativa
após falha definitiva usa outra chave/encomenda. Resultado incerto nunca reinicia cobrança.
