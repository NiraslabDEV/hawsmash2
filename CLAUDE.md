# CLAUDE.md — HAWSMASH 2.0 · Restaurant OS multi-unidade

> **O que é:** o sistema que passa a correr **todo** o negócio do HAWSMASH — **balcão (POS), delivery,
> levantamento, pagamentos, estoque, caixa e cozinha** — em **duas lojas** (Maputo e Matola), num só painel.
> Motor herdado do **Delivery OS** (instância Casa do Bom Pasteleiro / Babalaza), fundido com tudo o que o
> **HAWSMASH 1.0** já tem em produção.
>
> **Dono do produto:** Niraslab / Leapfrog — Gabriel dos Santos · niraslab.dev@gmail.com
> **Cliente:** Ridwan · HAWSMASH (Maputo + Matola, Moçambique)
>
> Este ficheiro é a **fonte de verdade**. O plano de execução está em **[`ROADMAP.md`](ROADMAP.md)**.
> O plano de **empacotamento** (instalar este motor noutro restaurante) está em
> **[`ROADMAP-PRODUTO.md`](ROADMAP-PRODUTO.md)** — ver §18. As regras de trabalho do agente estão em
> **[`AGENTS.md`](AGENTS.md)** — ler antes de escrever código.

---

## 0. CONTEXTO COMERCIAL (factos fechados — condicionam o âmbito)

| | |
|---|---|
| **Proposta** | `NL-2026-HS-EXP` — "Duas lojas, um só sistema" (`docs/legacy/Proposta-NL-2026-HS-EXP.html`) |
| **Fechado** | **50.000 MT** de implantação (pagamento único) + **20.000 MT/mês** de operação e suporte |
| **Prazo** | **Fase 1 pronta para a abertura das duas lojas** — as duas abrem **no mesmo dia**. Fase 2 até 6 semanas depois |
| **Não negociável na abertura** | **POS de balcão a cobrar** · **cozinha a imprimir** · **caixa a fechar** · **delivery a cair na loja certa** · **estoque a controlar** |
| **Fora de âmbito** | Facturação fiscal certificada (AT), equipamento (é do cliente), integrações de terceiros, 3.ª loja |
| **Equipamento** | PC touch + impressora térmica + gaveta por loja, a cargo do HAWSMASH. Especificação em [`docs/operacao/hardware.md`](docs/operacao/hardware.md) |

**Leitura operacional do preço:** a 20.000 MT/mês pelas duas lojas, **o suporte tem de ser barato de prestar**.
Isso é uma decisão de arquitectura, não de simpatia: o sistema tem de **avisar sozinho quando falha**,
**recuperar sozinho** do que for recuperável e **nunca perder uma venda** por causa de rede, papel ou reinício.
Cada decisão neste ficheiro que parecer "trabalho a mais" existe para não gerar um telefonema às 20h de sábado.

---

## 1. AS QUATRO REGRAS QUE MANDAM EM TUDO

1. **A venda nunca pára.** Impressora, email, pixel, CAPI, realtime e internet são **best-effort**. Nada disso
   pode impedir registar uma venda. Se a rede cair, o POS vende **offline** e sincroniza depois (§7.5).
2. **O preço é do servidor.** O cliente e o POS enviam **ids + quantidades + `client_sale_id`**. O servidor
   recalcula **sempre** a partir da BD. Dinheiro em **centavos inteiros**. Nunca float.
3. **Cada linha pertence a uma loja.** Toda a tabela operacional tem `store_id` e RLS que a faz cumprir.
   Um utilizador da Matola **não consegue** ler nem escrever nada de Maputo. Testado, não assumido (§11.4).
4. **Repetir uma operação não a duplica.** Todo o caminho que cria dinheiro ou papel é **idempotente**:
   `client_sale_id` no POS, `idempotency_key` no webhook, `(order_id, station, kind)` no `print_jobs`.

---

## 2. TOPOLOGIA

| Ambiente | Onde | Branch | Supabase |
|---|---|---|---|
| **LIVE** | `hawsmash.com` | `main` | projecto `hawsmash2-staging` (`pqjoan…`) — a base onde a loja vende desde 22/09 ([ADR 0008](docs/decisions/0008-staging-passa-a-live.md)); **a passar para a org Pro** (PITR + backups) |
| **STAGING** | `*-staging.up.railway.app` | `dev` | **por recriar** — até os terminais passarem para `hawsmash.com/pos`, este endereço serve a base do LIVE |
| **POS / bridge** | mini-PC em cada loja | — | fala com o LIVE + LAN local |

> ⚠️ **Desde 29/09 o `supabase` CLI deste repositório está ligado ao LIVE.** `supabase db push` aplica na
> loja. Até haver staging novo, migration nova passa por revisão e dry-run, fora do horário de loja.

Topologia decidida na [ADR 0008](docs/decisions/0008-staging-passa-a-live.md), que substitui o plano original (LIVE no `hawsmash2`, hoje sem uso). Evidências anteriores em [BLOQUEIOS](BLOQUEIOS.md), B-010 e B-022, e no [plano LIVE](docs/planos/live.md), agora histórico.

### Regra de ouro
```
dev → testar staging → merge main → live
NUNCA editar main directamente. NUNCA correr SQL à mão em produção — só migrations versionadas.
```

> **Diferença deliberada face ao HAWSMASH 1.0:** o 1.0 partilhava um único projecto Supabase entre staging e
> live — qualquer migration ia a produção no instante. **No 2.0 isso acaba.** Staging tem BD própria; migrations
> correm primeiro lá. É a condição para poder mexer no sistema com duas lojas a vender. *(Temporariamente
> suspenso desde 29/09 — ADR 0008: recriar o staging é o próximo passo.)*

---

## 3. STACK (decisões fechadas — mudar só com ADR em `docs/decisions/`)

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript |
| UI | Tailwind + shadcn/ui; tema escuro + dourado `--gold #e5a93c`. **A partir da P1 a marca vive na BD** (`brand_settings`); `config/brand.ts` é só o fallback de fábrica (§18.2) |
| Estado | TanStack Query (retry/reconexão) · POS com cache local (IndexedDB) |
| Backend | Supabase (Postgres + RLS + Realtime + Auth + Storage) |
| Validação | Zod em toda a boundary |
| Pagamentos | **Paysuite** (M-Pesa/e-Mola automático, validado em produção) · **M-Pesa directo** da Vodacom, sem gateway pelo meio · **manual por comprovativo** (fallback) · **balcão** (dinheiro/cartão/móvel). Escolhe-se por loja em `stores.payment_provider` |
| Email | SMTP Hostinger (`nodemailer`, route handlers) — a caixa do próprio dono, herdado do 1.0 (ADR 0004). O Railway bloqueia SMTP fora do Pro: com `EMAIL_RELAY_SECRET` sai pela função `email-relay` do Supabase (ADR 0010), com o Resend de reserva (ADR 0009) |
| Impressão | `services/print-bridge` (Node, ESC/POS TCP 9100) — um por loja, 24/7, com **HTTP local na LAN** |
| Monorepo | pnpm workspaces + Turborepo |
| Testes | Vitest (domínio/RLS) + Playwright (e2e do POS e do checkout) |
| Hosting | Railway (web) + Supabase Cloud + mini-PC por loja |

**Regra:** o cliente final (quem come) usa **sempre** o browser. Zero instalação. O **POS** é uma **PWA** —
instala-se no PC touch como aplicação, mas continua a ser web.

---

## 4. ESTRUTURA DO REPOSITÓRIO

O [índice](docs/README.md) reúne operação, módulos, referências e arquivo.
Código em `apps/web/`, `packages/` e `services/print-bridge/`; SQL em `supabase/migrations/`.
[Mapa de arquitectura](docs/desenvolvimento/arquitectura.md).

---

## 5. MULTI-UNIDADE — o coração do 2.0

Uma instância é uma empresa; `store_id` é unidade física, nunca tenant.
Catálogo partilhado; preços efectivos, disponibilidade, numeração e operação por loja.

- O kill switch real é `stores.accepting_orders`; `settings` é só da empresa e não fecha loja nenhuma.
- `slug` e `order_prefix` são imutáveis depois de criados (histórico, cookies, `.env` da bridge).
- Horário, zonas, números de pagamento e provider vivem em `stores`; nunca o mesmo campo nos dois sítios.

[Contrato e gestão de lojas](docs/modulos/lojas.md).

---

## 6. EQUIPA, PERFIS E AUDITORIA

| Perfil | Vê | Pode |
|---|---|---|
| `owner` | **todas** as lojas | tudo: definições, preços, equipa, anulações, consolidado |
| `manager` | as suas lojas | operação completa da loja: aprovar, anular, caixa, sangria, estoque, cardápio |
| `cashier` | a sua loja | vender, imprimir, receber, gaveta **em venda**, o seu caixa; aprovar/recusar pedidos online depois de conferir o comprovativo; marcar esgotado/disponível. **Não** anula venda paga (decisão do dono, 23 Set) |
| `kitchen` | a sua loja | ver pedidos e avançar preparo (em preparo → pronto). **Não vê dinheiro** — ainda não imposto na BD, B-116 |

Imposto na BD, não no ecrã: `advance_order` por perfil e `confirm_payment` só do servidor (1097), `void_sale` só
manager/owner, comprovativos só da loja e sem cozinha (1099). Acções sensíveis gravam `event_log` com actor e loja.
O POS abre a sessão Supabase **de cada operador** por cartão + PIN — nunca uma sessão do terminal.
[Equipa, permissões exigidas e efectivas](docs/modulos/equipa.md).

---

## 7. POS DE BALCÃO — o módulo novo

POS touch, PWA, pagamentos, turnos e fila IndexedDB com `client_sale_id`.
Servidor fixa preços e estado; impressão/rede degradam sem perder a venda.

- `create_counter_sale` é transaccional e idempotente por `client_sale_id`; recalcula preço e troco, baixa stock.
- Anular é `void_sale` (manager/owner, motivo, repõe stock); a venda anulada nunca desaparece. Reimprimir loga.
- Sangria/reforço/despesa levam `p_request_id` (1098). Nunca um `confirm()` do browser em fluxo de venda.
[Fluxos, definições e contrato offline (§7.5 original)](docs/modulos/pos.md).

---

## 8. IMPRESSÃO E GAVETA

Uma bridge por loja; fila, ESC/POS TCP ou USB Windows e HTTP local autenticado.
Dois talões completos por defeito; modelos e vias configuráveis (ADR 0007).
[Impressão, gaveta e limites físicos](docs/modulos/impressao.md).

---

## 9. CAIXA (por loja, por turno)

Turno: fundo, movimentos, contagem, diferença e fecho; dinheiro separado dos restantes meios.
Fecho do dia agrega turnos congelados desde o último fecho, com chave de idempotência.
[Caixa e falhas conhecidas](docs/modulos/caixa.md).

---

## 10. ESTOQUE (por loja)

Produto final por loja; ingredientes e ficha técnica por produto/variante.
Baixa transaccional na confirmação, reposição na anulação e custo histórico em centavos.
[Estoque, custos e contagens](docs/modulos/estoque.md).

---

## 11. ROBUSTEZ — o programa completo

Preço do servidor, centavos, loja, idempotência, best-effort, auditoria e UTC/Maputo são invariantes.
Realtime só dispara `refetch`; testes e migrations em staging precedem produção.
[Contrato integral §§11.1–11.9](docs/desenvolvimento/robustez.md), [testes](docs/referencia/testes.md) e [pagamentos](docs/modulos/pagamentos.md).

---

## 12. PEDIDO — canais e máquina de estados

Delivery, levantamento, balcão e mesas; transições só por `advance_order`, nunca por update directo.
Papel na aprovação/confirmação é best-effort: falha vira `print.enqueue_failed`, não reverte o pedido (1097).
A máquina pura herdada não é a autoridade de todos os estados actuais.
[Pedidos](docs/modulos/pedidos.md) · [mesas](docs/modulos/mesas.md).

---

## 13. SITE PÚBLICO (o canal que já factura)

Loja explícita no cardápio/checkout; preço e disponibilidade vêm do servidor.
[Site e checkout](docs/modulos/site-checkout.md) · [conta do cliente](docs/modulos/conta-cliente.md).
[Agentes](docs/modulos/agentes.md) preparam revisão; a pessoa conclui o checkout.
[Marketing](docs/modulos/marketing.md) · [relatórios](docs/modulos/relatorios.md).

---

## 14. TVs

TV configurada, menu e senhas têm rotas públicas por loja. KDS continua planeado.
Configuração/vídeos/cache por loja; hardware exige ensaio próprio.
[TVs, senhas e KDS](docs/modulos/tvs-kds.md).

---

## 15. MIGRAÇÃO DO HAWSMASH 1.0

O 1.0 vende até ao cutover; dry-run, backup, contagens e reconciliação são obrigatórios.
O importador cobre menos dados do que o plano e tem riscos documentados.
[Plano e alcance real](docs/operacao/migracao.md).

---

## 16. PERGUNTAS EM ABERTO (decidir com o cliente antes da fase respectiva)

Perguntas e decisões iniciais estão [arquivadas sem contactos privados](docs/historico/decisoes-iniciais.md).
O estado vivo está em [BLOQUEIOS](BLOQUEIOS.md), com IDs estáveis e resolvidos no arquivo.
Configuração pendente não equivale a funcionalidade validada.

---

## 17. NÃO FAZER

- ❌ Policy `using (true)` em tabela com `store_id` — isolamento de loja é a regra 3.
- ❌ Confiar no cliente (browser **ou POS**) para preço, taxa, troco, desconto ou estado de pagamento.
- ❌ Float para dinheiro. Centavos inteiros, sempre, via `packages/core/src/money.ts`.
- ❌ Bloquear a venda por causa de impressora, email, pixel, CAPI ou realtime.
- ❌ Criar venda no POS sem `client_sale_id` — é o que impede cobrar duas vezes.
- ❌ Construir estado a partir do payload do realtime (só `refetch`).
- ❌ SQL manual em produção; migration não versionada; editar `main` sem passar por staging.
- ❌ `anon` com SELECT directo em tabela — acesso público só por RPC `SECURITY DEFINER`.
- ❌ URL pública do bucket `payment-proofs` (é privado) — só `createSignedUrl`.
- ❌ Segredo (service key, Paysuite, CAPI, SMTP) em código do cliente.
- ❌ Abrir gaveta sem perfil e sem registo em `event_log`.
- ❌ Apagar venda anulada — anula-se com motivo, nunca se apaga.
- ❌ `tenant_id`, planos comerciais ou gating por plano. `store_id` é unidade física, não inquilino.
- ❌ **Identidade de cliente em código** — nome, cor, logo ou texto de marca dentro de `config/brand.ts`
  ou de um componente. Isso é dado, não ficheiro (§18.2). Travado por
  `config/__tests__/brand-factory.test.ts`.
- ❌ **Nome de cliente em caminhos, tabelas ou variáveis do produto.** O produto não sabe como se
  chama o cliente que o está a usar. Travado por `config/__tests__/nomes-de-cliente.test.ts`.
- ❌ **Perguntas e respostas do chat dentro do código** — são conteúdo de loja, vivem em `chat_topics` (§19).
- ❌ **Frases do upsell, notas rápidas ou meios de pagamento do POS dentro do código** — vivem em
  `store_pos_settings` (§7.7). O código só tem o valor de fábrica, neutro.
- ❌ Avançar fase do ROADMAP com testes vermelhos.

---

## 18. PRODUTO — do HAWSMASH ao Restaurant OS instalável

Uma instância por cliente, com BD/deploy/domínio próprios; código comum sem identidade de cliente.
Marca é dado; actualizações forward-only fora do horário; suporte escalável e observável.
[Regras completas §§18.1–18.5](docs/modulos/aparencia.md) · [plano](ROADMAP-PRODUTO.md).

---

## 19. ATENDIMENTO NO SITE — chat guiado + balcão *(Fase 2 · ideia fechada em 2026-08-28)*

Chat guiado com passagem ao balcão é Fase 2, distinto de MCP/WebMCP.
Nunca trava a venda; isolamento, conteúdo na BD, token opaco e rate-limit são requisitos.
[Regras completas e pendências](docs/planos/atendimento.md).

---
