# Arquitectura e mapa do repositório

O mapa abaixo preserva o desenho inicial. A estrutura actual está no [índice](../README.md): migrations em `supabase/migrations/`, provider em `packages/payments/`, 16 abas no painel. KDS é planeado. Caminhos na árvore são esquemáticos.

## 4. ESTRUTURA DO REPOSITÓRIO

```
/apps/web
  /app/(public)/            loja: escolha de loja, cardápio, checkout, order-status
  /app/(admin)/             painel: pedidos, caixa, estoque, cardapio, clientes,
                            analise, equipa, lojas, definicoes, marketing, sistema
  /app/(pos)/pos/           POS de balcão (PWA, touch, offline-capable)
  /app/(tv)/tv/[store]/     ecrãs de TV: menu board · senhas · (F2) KDS
  /app/api/                 webhooks, emails, health, track, cron
/config/brand.ts            fallback de fábrica APENAS — a identidade real vive em brand_settings (§18.2)
/packages/core              money, order-machine, schemas (Zod) — domínio puro, testado
/packages/db                migrations SQL + seed + tipos + testes de RLS
/packages/paysuite          provider Paysuite + mock
/packages/receipt           o papel da casa: formatos do talão, modelos, ESC/POS e pré-visualização (bridge + painel)
/services/print-bridge      poll print_jobs + servidor HTTP local + ESC/POS + gaveta
/docs/engine/               spec completa do motor herdado (Delivery OS) — consulta
/docs/legacy/               HAWSMASH 1.0 (CLAUDE, roadmap, edge functions, print-bridge, proposta)
/docs/operacao/hardware.md           equipamento, ligações, rede, contingência
/docs/operacao/runbook.md            operação: monitorização, alertas, backups, incidentes
/docs/decisions/            ADRs
ROADMAP.md · AGENTS.md
```

> `docs/engine/DELIVERY-OS-CLAUDE.md` descreve o motor herdado (§16 tracking, §17 referral, §20 CRM,
> §21 emails, §24 entregadores, §26 aparência…). **Continua a valer** onde este ficheiro não o contradiz.
> Onde colidir, **manda este ficheiro** — é a instância.
