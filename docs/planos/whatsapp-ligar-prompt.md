# Prompt — ligar o WhatsApp do HAWSMASH e fechar o que falta (Codex)

> Para um agente de código a trabalhar neste repositório. Lê primeiro [`AGENTS.md`](../../AGENTS.md) e
> [`CLAUDE.md`](../../CLAUDE.md) (regras 1–4 e §17), depois [ADR 0011](../decisions/0011-whatsapp-business-por-adaptador.md),
> [ADR 0012](../decisions/0012-pedido-pelo-whatsapp-na-conversa.md) e [o plano](whatsapp.md), incluindo o §8 (custo).
> Estado actualizado a 05/11/2026, perto da meia-noite de Maputo.

> **Já feito, não repitas:** T1 (commit), T2 (1117/1118/1124/1125 no LIVE), T8 (painel), T9 (alertas). **T10 cancelada**
> (ver lá). **Falta:** aplicar a 1126, T3 se ainda não tiver sido feita, e T4–T7, que dependem das contas na Meta.

---

## 0. Onde estamos

O cliente vai poder **pedir, pagar e mandar o comprovativo sem sair do WhatsApp**, e receber os avisos do pedido
(pago, pronto, a caminho, entregue). O código está escrito, testado e commitado no `dev`; **nada está ligado** e nada foi
ensaiado ainda contra a Meta real (B-124).

| Peça | Onde | Estado |
|---|---|---|
| Contrato + transportes **Meta Cloud API** (escolhido), Tyxter (alternativa), mock | `packages/whatsapp/src/` | ✅ 61 testes |
| Fila, recepção, opt-out, webhooks (portátil) | `supabase/migrations/20261030190000_1117_whatsapp_base.sql` | ✅ ensaio 34/34 |
| Avisos do pedido por gatilho (F1) | `supabase/migrations/20261030190100_1118_whatsapp_pedidos.sql` | ✅ |
| Conversas: estado com versão, respostas na fila, retoma (portátil) | `supabase/migrations/20261105180000_1124_whatsapp_conversas.sql` | ✅ |
| Pedido na conversa + comprovativo (restaurante) | `supabase/migrations/20261105180100_1125_whatsapp_pedido_na_conversa.sql` | ✅ ensaio 11/11 |
| Despacho/webhook | `apps/web/lib/whatsapp/dispatch.ts`, `config.ts`, `events.ts`, `templates.ts` | ✅ |
| Motor da conversa, IA, orquestrador | `apps/web/lib/whatsapp/pedido/{engine,ai,run,state,catalogue}.ts` | ✅ |
| Painel do dono + uso do mês (T8) | `apps/web/app/(admin)/whatsapp/` (aba própria desde 10/11), `apps/web/lib/whatsapp/painel.ts`, migration 1126 | ✅ falta aplicar a 1126 |
| Alertas e resumo por WhatsApp (T9) | `apps/web/lib/alerts/whatsapp.ts` | ✅ |
| Rotas | `apps/web/app/api/webhooks/whatsapp/route.ts` (GET hub.challenge + POST), `apps/web/app/api/cron/whatsapp/route.ts` | ✅ |
| Submeter templates | `scripts/whatsapp-templates.ts` (`--dry-run`, `--status`) | ✅ dry-run verificado |
| Cron | `scripts/sql/install-whatsapp-cron.sql` | ✅ por instalar |
| Ensaios SQL | `supabase/tests/whatsapp.sql` (pgTAP), `whatsapp_conversa.sql` e `whatsapp_painel.sql` (DO + ROLLBACK) | ✅ |

**Migrations no LIVE:** 1117, 1118, 1124 e 1125 aplicadas a 05/11 pelo Gabriel. **Confirma antes de tudo** com
`supabase migration list --linked` (o CLI está ligado ao LIVE `pqjoan…`) se a 1126 já lá está.

**Há outras sessões a trabalhar na mesma árvore** (ex.: garçons, migration `20261105120000_1122_garcons.sql`, já
aplicada no LIVE). Os ficheiros partilhados (`CLAUDE.md`, `BLOQUEIOS.md`, `ROADMAP.md`, `.env.example`,
`apps/web/package.json`, `pnpm-lock.yaml`, `docs/…`) têm alterações delas por commitar. **Nunca** commites,
reverts, moves ou formates trabalho que não é do WhatsApp.

---

## 1. Regras desta corrida (além do AGENTS.md)

1. **A venda nunca pára.** Nada do WhatsApp pode bloquear POS, cozinha, caixa ou site. Os gatilhos da 1118 têm
   `exception when others` — mantém-no em qualquer gatilho novo.
2. **Nada de SQL à mão no LIVE.** Ligar uma loja, mudar um número, instalar dados: **migration versionada**
   (ou o ecrã do painel da T8, quando existir). Excepção já aceite no projecto: os `scripts/sql/install-*.sql`
   de cron, que usam o Vault.
3. **Migrations no LIVE só fora do horário** (Maputo fecha 21:30 à quinta; confirma com o RPC público
   `list_public_stores` → `open_now:false`) e **só com ordem explícita do Gabriel**, pela skill/procedimento
   `aplicar-migration-supabase`: pasta isolada, dry-run, mostrar a lista, aplicar. Se o teu ambiente bloquear o
   `--yes` em produção, entrega o comando exacto ao Gabriel e continua com o resto.
4. **Segredos** (`META_*`, `ANTHROPIC_API_KEY`, `CRON_SECRET`) só no Railway / Vault. Nunca em ficheiro, commit,
   log ou mensagem.
5. **Numeração de migrations:** antes de criar uma, `ls supabase/migrations | tail` **e** `supabase migration list --linked`.
   Usa o número seguinte livre e um carimbo de data **único** (outra sessão já colidiu uma vez no mesmo carimbo).
6. **Testes primeiro** no que mexe com dinheiro, estado do pedido, RLS e idempotência. Comandos no §4.
7. Comentários e docs em português de Portugal, no tom dos existentes. Sem nome de cliente em código do produto
   (travado por `config/__tests__/nomes-de-cliente.test.ts` e `brand-factory.test.ts`).

---

## 2. O que só uma pessoa pode fazer (não tentes — regista e segue)

Lista para o Gabriel/Ridwan. Quando cada valor chegar, retoma a tarefa correspondente.

| # | Quem | O quê | Desbloqueia |
|---|---|---|---|
| H1 | Ridwan | Acesso ao **Facebook Business** do HAWSMASH (B-122) | H2 |
| H2 | Gabriel | developers.facebook.com → app tipo *Business* → produto **WhatsApp** → WABA. Anotar `WABA_ID`, `phone_number_id` do **número de teste** | T4, T5 |
| H3 | Gabriel | **Utilizador de sistema** com `whatsapp_business_messaging` + `whatsapp_business_management` → token permanente. **Segredo da app** (App settings → Basic) | T4 |
| H4 | Gabriel | Verificar até 5 telemóveis de ensaio no número de teste da Meta | T6 |
| H5 | Ridwan | Decidir que o **+258 87 030 1006** sai da app do telemóvel e registá-lo na WABA (ou dar outro número) — B-122 | T7 |
| H6 | Gabriel | `ANTHROPIC_API_KEY` para a IA (opcional; sem ela a conversa é só por botões) | T4 |
| H7 | Gabriel | Ordem para aplicar no LIVE e para fazer deploy (dev → main) | T2, T3 |
| H8 | Gabriel | Adenda à proposta `NL-2026-HS-EXP`: preço repassado, com o valor confirmado no rate card da Meta ("Rest of Africa"; contas no plano §8) | facturação |
| H9 | Ridwan/Gabriel | **Método de pagamento na conta WhatsApp** (Meta Business Suite). Sem ele a Meta deixa de entregar as respostas (regra desde 1/10/2026) | T6, T7 |

---

## 3. Tarefas do agente, por ordem

### T1 — Commit isolado do WhatsApp (sem levar trabalho alheio) · ✅ feito (`b75c6f3`)

Mantém-se a técnica para os commits seguintes: há outras sessões com coisas no índice partilhado, por isso usa um
`GIT_INDEX_FILE` privado e `git update-ref refs/heads/dev <novo> <antigo>`, que falha se o HEAD mudar a meio.

1. `git status --short` e `git diff --stat`. Os ficheiros **novos** do WhatsApp entram inteiros:
   `packages/whatsapp/`, `apps/web/lib/whatsapp/`, `apps/web/app/api/{cron,webhooks}/whatsapp/`,
   `supabase/migrations/*_{1117,1118,1124,1125}_whatsapp_*.sql`, `supabase/tests/whatsapp*.sql`,
   `scripts/whatsapp-templates.ts`, `scripts/sql/install-whatsapp-cron.sql`,
   `docs/decisions/0011-*.md`, `docs/decisions/0012-*.md`, `docs/planos/whatsapp.md`, `docs/planos/whatsapp-ligar-prompt.md`.
2. Ficheiros **partilhados**: só os blocos do WhatsApp. Sem `git add -p` interactivo: `git diff <f> > /tmp/f.patch`,
   apagar do patch os hunks que não são do WhatsApp, `git apply --cached /tmp/f.patch`. Blocos do WhatsApp:
   - `apps/web/lib/agents/service.ts` — exportações `readCatalogue`, `usableItem`, `quoteLine`, `priceItems`, tipos e
     campos de pagamento opcionais no `menuSchema` (inteiro é do WhatsApp);
   - `apps/web/package.json` — `@delivery/whatsapp` e `@anthropic-ai/sdk`; `pnpm-lock.yaml` — só as entradas destes;
   - `apps/web/next.config.mjs` — `@delivery/whatsapp` em `transpilePackages`;
   - `.env.example` — bloco "WhatsApp Business (ADR 0011, 0012)" até `WHATSAPP_AI_MODEL=`;
   - `BLOQUEIOS.md` — B-121, B-122, B-123; `ROADMAP.md` — secção "WhatsApp Business — 2026-10-30";
   - `CLAUDE.md` — as 3 linhas "**WhatsApp** (ADR 0012)…" no §13; `docs/referencia/crons.md` — linha `whatsapp`;
   - `docs/decisions/README.md` — linhas 0011 e 0012; `docs/README.md` — só a entrada do WhatsApp, se existir.
3. `git diff --cached --stat` tem de mostrar só isto. Testes do §4 verdes. Commit no `dev`:
   `feat(whatsapp): pedido na conversa pela Cloud API da Meta, comprovativo e avisos (ADR 0011, 0012)`.
4. **Não faças push** sem ordem.

Aceitação: `git show --stat HEAD` sem ficheiros de garçons/mesas/storefront; `git status` continua a mostrar o
trabalho das outras sessões intacto.

### T2 — Migrations no LIVE · ✅ 1117/1118/1124/1125 · ⏳ falta a 1126, com o mesmo procedimento

Procedimento `aplicar-migration-supabase`:
1. Fora do horário (regra 3) e com H7.
2. Pasta isolada no temporário: `supabase/config.toml`, `supabase/.temp/`, todas as `supabase/migrations/*.sql`
   **mais** as quatro que só existem no Remote, tiradas do ramo onde vivem:
   `git show codex/vendedora-virtual:supabase/migrations/<f>` para `20260928011457_assistente_virtual.sql`,
   `20260928093400_assistente_clips.sql`, `20260928111820_checkout_manual_idempotente.sql`,
   `20260928111824_comprovativo_estado_publico.sql`. **Nunca** `supabase migration repair`.
3. Apaga da pasta qualquer migration pendente que não seja do WhatsApp.
4. `supabase db push --include-all --dry-run` → tem de listar **só** as do WhatsApp por aplicar.
5. `supabase db push --include-all` (ou entrega o comando ao Gabriel).
6. Verifica: `supabase migration list --linked`; e, pelo REST com a chave pública, que `whatsapp_conversations`
   **não** é legível por anon (deve dar 401/403/permission denied).

São inofensivas sem número: nenhuma loja tem `whatsapp_enabled`.

### T3 — Deploy

Topologia actual (ADR 0008): o LIVE é o projecto `pqjoan…` e o site é `hawsmash.com` a partir de `main`.
Com H7: merge `dev → main` seguindo a regra do CLAUDE §2. Depois do deploy:
- `curl -i https://hawsmash.com/api/webhooks/whatsapp` → **503 `whatsapp_not_configured`** (esperado, sem envs);
- `curl -i -H "Authorization: Bearer $CRON_SECRET" https://hawsmash.com/api/cron/whatsapp` → **503** (idem).
Nenhum fluxo existente pode mudar: smoke do checkout manual e do POS como de costume.

### T4 — Variáveis no Railway (com H2, H3, H6)

`WHATSAPP_PROVIDER=meta`, `META_WHATSAPP_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` (gerar ≥ 32
caracteres aleatórios, `openssl rand -hex 24`), opcional `META_GRAPH_VERSION` (por defeito `v26.0`, a mais recente a
05/11/2026), `ANTHROPIC_API_KEY`, opcional `WHATSAPP_AI_MODEL` (por defeito `claude-opus-5-5` com esforço baixo;
`claude-haiku-5-5` é a opção mais barata, decisão do Gabriel em B-124). Pelo `railway` CLI
no serviço web certo (confirma com `railway status`), sem ecoar valores. Redeploy.

Aceitação: `curl "https://hawsmash.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=123"`
→ `200 123`; com token errado → `403`.

### T5 — Meta pela API (com o token)

1. `GET /{WABA_ID}/phone_numbers` — anotar `id` do número de teste (e depois o de Maputo).
2. Webhook: na app Meta (painel, H2) callback `https://hawsmash.com/api/webhooks/whatsapp` + verify token,
   campo `messages`. Pela API: `POST /{WABA_ID}/subscribed_apps` para a WABA mandar eventos à app.
3. Templates: `APP_BASE_URL=https://hawsmash.com META_WABA_ID=… npx tsx scripts/whatsapp-templates.ts --dry-run`,
   depois sem `--dry-run`, depois `--status` até `APPROVED`. Recusado → ler `rejected_reason`, corrigir o texto em
   `apps/web/lib/whatsapp/templates.ts` com **nome novo** (`hs_pedido_pago_v2`), actualizar `events.ts`, testes
   `templates.test.ts` verdes, voltar a submeter. Nunca editar um template aprovado em uso.

### T6 — Ensaio de ponta a ponta com o número de teste

1. No painel (WhatsApp → Ligação, sessão de dono), ligar uma **loja de ensaio**, não a de Maputo: se não houver loja de
   ensaio no LIVE, regista em BLOQUEIOS e pergunta ao Gabriel qual usar — não ligues Maputo ao número de teste.
   Id do número = `phone_number_id` do teste; interruptores Avisos e Conversa; número de atendimento.
2. Instala o cron: `scripts/sql/install-whatsapp-cron.sql` (só depois de `GET /api/cron/whatsapp` dar 200).
3. De um telemóvel verificado (H4) escreve para o número de teste e percorre: "olá" → Ver cardápio → produto
   com variante e molho → quantidade 2 → Finalizar → Levantar → nome → Confirmar → recebe total + M-Pesa →
   manda uma foto → "Comprovativo recebido" → no POS o pedido aparece com o comprovativo → aprovar → chega o
   template "pago". Repetir "Confirmar" não cria outro pedido. Texto livre ("quero 2 refrescos") funciona com
   `ANTHROPIC_API_KEY` e cai nos botões sem ela.
4. Verifica na BD (leitura): `whatsapp_outbox` com `kind='service'` aceites; `whatsapp_inbound.processed_at`
   preenchido; `order_attribution.channel='whatsapp'` no pedido; `event_log` com `whatsapp.order_created` e
   `whatsapp.proof_received`.
5. Mede: quantas mensagens saíram num pedido real (o plano §8 diz 13) e o custo da IA por mensagem (`usage` na resposta
   da API), para o Gabriel decidir o modelo em B-124. Ensaia também quem esconde o número, se houver como.
6. Desliga a loja de ensaio no painel no fim.

Regista o resultado no ROADMAP (`[x] ⏳` → `[x]`) e no plano.

### T7 — Ligar Maputo (com H5 e o ensaio verde)

No painel (WhatsApp → Dados), em dias/horas diferentes se o Gabriel quiser:
1. **Avisos:** id do número = `phone_number_id` de Maputo, telefone `+258870301006`, telemóveis dos alertas, interruptor Avisos.
2. **Conversa:** número de atendimento `+258860760009` (o da marca, que fica na app — confirma com o Gabriel), interruptor Conversa.
Matola fica desligada até haver número (B-122). Desligar = o mesmo interruptor.

### T8 — Ecrã "WhatsApp" no painel do dono · ✅ feito (falta aplicar a 1126)

Para deixar de precisar de migration para ligar/desligar e para facturar o uso (B-123).
1. RPC `save_store_whatsapp(p_store_id, p_payload)` `security definer`, **só owner**
   (`private.auth_is_owner()` + `private.auth_can_store`), valida E.164, respeita as constraints da 1117/1124
   (`chat` exige `enabled`; `enabled` exige `sender_id`), grava `event_log` `whatsapp.settings_changed` com actor.
   Migration nova + testes SQL: manager/cashier recusados, outra loja recusada, constraints.
2. Página owner-only em `apps/web/app/(admin)/…` ao lado das definições de pagamento da loja: número, interruptores
   "Avisos" e "Conversa de pedido", número de atendimento humano. Mesmo padrão visual das páginas de definições
   existentes (lê uma antes de escrever).
3. Histórico só de leitura (RLS da 1117/1124 já restringe a owner + loja): últimas mensagens enviadas
   (`whatsapp_outbox`: evento, estado, erro) e recebidas; **contagem do mês por `kind`** (`utility` paga sempre;
   `service` paga acima de 1.000 por número) — é a base da cobrança ao cliente.
4. Testes de componente/RLS e `pnpm test` verde.

### T9 — W2: alertas ao dono por WhatsApp (F4 do plano) · ✅ feito (`stores.whatsapp_alert_phones`, escolhidos no painel)

Os alertas de `/api/cron/alerts` (POS offline, impressora, stock crítico, pedido sem aprovação) e o digest diário
passam a sair também por template para os telemóveis do dono/gerente, com o mesmo arrefecimento de 30 min; o email
fica. Templates novos em `templates.ts` (`hs_alerta_*`, Utility) com teste de paridade; destinatários configuráveis
por loja (decide onde guardar — coluna nova ou `staff_profiles` — e escreve a decisão no plano); enfileirar por
`whatsapp_enqueue` com `subject_type='alert'`. Nunca bloquear o cron de alertas se o WhatsApp falhar.

### T10 — ~~Avisos grátis dentro da janela de 24 h~~ · ✖ cancelada

A premissa caiu: desde 1/10/2026 a Meta cobra também o que sai dentro da janela (plano §8). Trocar avisos por mensagens de
sessão só pouparia enquanto houvesse folga nas 1.000 grátis, e essa folga já é gasta pela conversa. Não implementar.

---

## 4. Como verificar (sempre antes de commit)

```bash
# pacote portátil
cd packages/whatsapp && npx vitest run && npx tsc --noEmit
# app (WhatsApp + canal de agentes, que o pedido reutiliza)
cd apps/web && npx vitest run lib/whatsapp lib/agents && npx tsc --noEmit -p .
# suite inteira a partir da RAIZ (os testes do PWA resolvem caminhos a partir da raiz)
pnpm test
# SQL na base local (nunca no LIVE)
supabase migration up --local
supabase test db --local supabase/tests/whatsapp.sql
(echo "begin;"; cat supabase/tests/whatsapp_conversa.sql; echo "rollback;") | docker exec -i supabase_db_hawsmash2 psql -U postgres -v ON_ERROR_STOP=1
# templates (não chama a Meta)
APP_BASE_URL=https://exemplo.test npx tsx scripts/whatsapp-templates.ts --dry-run
```

---

## 5. Armadilhas já conhecidas

| Sintoma | Causa | O que fazer |
|---|---|---|
| `db push` pede `--include-all` ou fala de versões só no Remote | `20260928…` aplicadas a partir do ramo `codex/vendedora-virtual` | trazer os ficheiros com `git show` para a pasta isolada; nunca `migration repair` |
| `--yes` em produção bloqueado | classificador do ambiente do agente | entregar o comando ao Gabriel |
| Duas migrations com o mesmo carimbo | sessões paralelas | carimbo único, número seguinte livre |
| Telefone do pedido em formato local (`841230001`) | o `create_order` normaliza | comparar sempre por `private.whatsapp_phone_mz(customer_phone)` |
| Resposta da conversa não é reclamada num ensaio SQL | dentro de uma transacção `now()` não avança e `due_at = now()+n ms` | é esperado; o claim por ids (`whatsapp_claim_ids`) não olha a `due_at` |
| A Meta manda vários eventos numa entrega | formato da Cloud API | já tratado: um `eventId` por mensagem/estado, deduplicado em `whatsapp_webhook_receipts` |
| A Cloud API não deduplica envios | sem idempotency-key na Meta | a fila é a idempotência; um timeout pode repetir um aviso (decisão aceite: repetido > perdido) |
| Webhook demora com a IA | uma chamada à API Claude por texto livre | o webhook responde 200 aos 8 s e o processamento continua no processo Node; o cron retoma o que morrer |
| Botões dos templates sem efeito | quick replies sem payload | `events.ts` manda `fb:up`/`fb:down`; o motor responde |
| Templates com `{{1}}` em vez de nomes | falta `parameter_format: NAMED` | o script já manda; não mudar para posicional sem mudar `meta.ts` |
| Template recusado por "leading or trailing params" | corpo a começar ou acabar numa variável | o teste de `templates.test.ts` já o trava; mantém-no |
| Respostas deixam de chegar sem erro no envio | conta na Meta sem método de pagamento (regra de 1/10/2026) | H9 |
| Mensagem sem `from` no webhook | username com o número escondido: só `from_user_id` (BSUID) | já tratado (`inbound_hidden` → `request_contact_info`); validar com um payload real (B-124) |
| Número de mensagens a subir | cada resposta conta para as 1.000 grátis | `compactSession` junta bolhas; o teste "um pedido típico" trava em 15 |

---

## 6. Entrega

No fim: ROADMAP e BLOQUEIOS actualizados (B-121 fecha quando Maputo estiver ligado; B-122 quando a Matola tiver
número), plano §5/§7 com o estado real, e uma lista curta para o Gabriel agrupada por quem desbloqueia o que
ficou pendente. Commits pequenos, convencionais, em português, só com ficheiros do WhatsApp.
