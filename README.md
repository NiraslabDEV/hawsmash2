# HAWSMASH 2.0 — Restaurant OS multi-unidade

> Sistema completo de restaurante para o **HAWSMASH** (Maputo + Matola): **balcão (POS), delivery,
> levantamento, pagamentos M-Pesa/e-Mola, estoque, caixa, cozinha e relatórios** — duas lojas, um só painel.
> Desenvolvido por **Niraslab / Leapfrog** (niraslab.dev@gmail.com).

| Documento | Para quê |
|---|---|
| **[`CLAUDE.md`](CLAUDE.md)** | **Spec do produto** — arquitectura, schema, regras invioláveis. Fonte de verdade |
| **[`ROADMAP.md`](ROADMAP.md)** | Plano por fases, com DoD e o **prompt único** da corrida contínua |
| **[`ROADMAP-PRODUTO.md`](ROADMAP-PRODUTO.md)** | Plano para **empacotar** o motor e instalar noutro restaurante (ver `CLAUDE.md` §18) |
| **[`AGENTS.md`](AGENTS.md)** | Como o agente de código trabalha aqui — **corrida contínua**, ler antes de codar |
| **[`BLOQUEIOS.md`](BLOQUEIOS.md)** | Registo vivo do que ficou por fechar e porquê — atacado de uma vez só no fim |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Equipamento por loja, ligações, testes de aceitação |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Operação: monitorização, alertas, backups, incidentes, abertura |
| [`docs/engine/`](docs/engine/) | Spec do motor herdado (Delivery OS) — consulta |
| [`docs/legacy/`](docs/legacy/) | HAWSMASH 1.0 em produção: spec, edge functions, print-bridge, proposta |

---

## Origem

Este repositório nasce da fusão de dois sistemas em produção:

- **Delivery OS** (Casa do Bom Pasteleiro / Babalaza) — motor Next.js + Supabase: loja online, painel,
  Paysuite (M-Pesa automático), print-bridge ESC/POS, caixa, estoque, tracking, CRM. É a **base do código**.
- **HAWSMASH 1.0** (`hawsmash.com`, a facturar ~360.000 MT/mês) — fluxo manual de comprovativos, aprovação por
  email, fecho de caixa, relatório semanal, impressora empacotada em `.exe`, horário configurável.
  É a **base da operação real** e da experiência do que falha em Moçambique.

O que o 2.0 acrescenta aos dois: **multi-unidade (`store_id`), POS de balcão com gaveta, modo offline,
perfis de equipa com auditoria, estoque e caixa por loja, ecrãs de TV**.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind/shadcn |
| Backend | Supabase (Postgres + RLS + Realtime + Auth + Storage) |
| Pagamentos | Paysuite (M-Pesa/e-Mola automático) · manual por comprovativo · balcão (dinheiro/cartão) |
| Impressão | `services/print-bridge` — ESC/POS TCP 9100 + HTTP local na LAN + gaveta |
| Testes | Vitest (domínio + RLS) · Playwright (POS e checkout) |
| Monorepo | pnpm workspaces + Turborepo |

```bash
pnpm install
pnpm dev            # web em localhost:3000
pnpm test           # vitest (todos os pacotes) — gate de merge
pnpm lint           # eslint + tsc
pnpm db:migrate     # aplica migrations + seed
pnpm db:types       # regenera tipos do schema
pnpm bridge:dev     # print-bridge com impressora simulada (sem hardware)
pnpm test:e2e       # playwright
```

---

## Ambientes

| | Branch | Supabase | Deploy |
|---|---|---|---|
| **Produção** | `main` | `hawsmash2` (Pro, PITR) | Railway |
| **Staging** | `dev` | `hawsmash2-staging` | Railway |

```
dev → testar staging → merge main → live
```

Migrations correm **primeiro em staging**. Nada de SQL manual em produção.

---

## Começar

1. `pnpm install`
2. `cp .env.example .env` e preencher (Supabase, Resend, Paysuite se aplicável)
3. `pnpm db:migrate` — cria schema e seed das duas lojas
4. `pnpm dev` → `http://localhost:3000` (loja) · `/admin` (painel) · `/pos` (balcão)
5. `pnpm bridge:dev` para simular a impressora

Estado do trabalho e próxima fase: **[`ROADMAP.md`](ROADMAP.md)**.
