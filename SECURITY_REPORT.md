# 🛡️ SECURITY_REPORT — HAWSMASH 2.0

Auditoria de segurança do sistema em produção (`hawsmash.com`). Cada rodada é uma secção com data; as
mais recentes ficam no topo. Formato: template-mestre Leapfrog `SECURITY-REPORT-TEMPLATE-MESTRE.md` v1.1.

---

## Rodada 1 — 13/10/2026 · bundle público + headers (REA)

**Quem:** Claude Code (Opus 5.5) a pedido do Gabriel. **Ferramenta:** REA (Reverse Engineer Anything),
servidor MCP `rea-agents`, análise estática sem execução.

### Âmbito

- **Analisado:** os 13 scripts que a página inicial de `hawsmash.com` carrega (598 KB, 179 módulos
  reconstruídos pelo REA, evidência `ev_c4cbd88e…08814fe`); headers HTTP da resposta `/`; source maps;
  o código das rotas que o bundle chama (`/api/track`, `/api/menu`).
- **Fora do âmbito desta rodada:** chunks das rotas internas (admin, POS, checkout, login) — a varredura
  de rotas foi bloqueada pela política do agente; ataques activos (injeção, concorrência, IDOR); Edge
  Functions e RLS do Supabase.

### Resultado do bundle

| Verificação | Resultado |
|---|---|
| Chaves/segredos no JS público (JWT, `service_role`, `sk_live`, `postgres://`, AWS, Google, Resend) | ✅ nenhum encontrado |
| Source maps servidos (`*.js.map`) | ✅ 404 — não expostos |
| Variáveis `NEXT_PUBLIC_*` no bundle | ✅ só `NEXT_PUBLIC_DEFAULT_STORE_SLUG` (não é segredo) |
| Endpoints que o bundle chama | `/api/menu` (GET), `/api/track` (POST) |
| Terceiros carregados | GTM, Meta Pixel, Typekit, Google Fonts, wa.me |

### Vulnerabilidades

| Vulnerabilidade | Severidade | Onde | Como explorar | Correção | Status |
|---|---|---|---|---|---|
| `/api/track` sem limites grava com service role | Média | `apps/web/app/api/track/route.ts` | `POST /api/track` com `{"type":"x","payload":{…100 KB…}}` em loop: cada pedido vira uma linha em `analytics_events` (service role ignora RLS). Enche a BD e falsifica o funil de vendas. | `lib/analytics/track-guard.ts`: corpo ≤ 2 KB (413), `type` só dos 9 eventos do site, `utm` só `utm_*` ≤ 200 chars, `payload` raso (≤ 10 chaves primitivas, strings ≤ 200), rate limit 60/min por IP (429) | ✅ Corrigido — `ca333e1` (main) / `dc013fa` (dev); testes em `lib/analytics/__tests__/track-guard.test.ts` |
| Sem headers de segurança + `x-powered-by` | Baixa | `apps/web/next.config.mjs` | Página (incl. checkout) pode ser embutida num iframe de terceiros (clickjacking); sem HSTS um primeiro acesso por HTTP pode ser interceptado; `x-powered-by: Next.js` facilita fingerprint. | HSTS 1 ano, `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; `poweredByHeader: false` | ✅ Corrigido — mesmo commit |
| Sem CSP para scripts | Baixa | `apps/web/next.config.mjs` | Um XSS que apareça no futuro corre sem barreira adicional. | CSP com lista de GTM, Pixel, Typekit, Paysuite e Supabase — primeiro em `Content-Security-Policy-Report-Only` no staging, depois a valer | Aberto |
| Rate limit do `/api/track` é por instância | Baixa | `track-guard.ts` | Com várias réplicas no Railway o limite efectivo multiplica-se. | Aceitável enquanto há 1 réplica; se escalar, mover para Redis/Supabase | Aberto (aceite) |

### Plano de remediação

1. ~~`/api/track` com limites~~ — feito 13/10.
2. ~~Headers de segurança~~ — feito 13/10.
3. **CSP report-only no staging** — próxima rodada (prazo: 2 semanas). Recriar o staging (ADR 0008) antes ajuda.
4. **Rodada 2 com âmbito completo:** chunks de admin/POS/checkout, `/akita-attack` com IDOR e concorrência
   no `create-order`, revisão das 7 Edge Functions e das policies RLS.

### Verificação pós-deploy

- **Staging, 13/10 (OK):** os 6 headers presentes e sem `x-powered-by`; `/api/track` → evento real 200, tipo inválido 400, corpo de 3 KB 413, payload aninhado 400, 61.º pedido no minuto 429. O staging serve a BD do LIVE: o teste gravou 1 evento `view_menu` com `utm_source=auditoria` em `analytics_events` (pode ser apagado ou ignorado no funil).
- Staging (`hawsmash2-staging.up.railway.app`) e live (`hawsmash.com`): ver a resposta de `/` com os 6 headers e sem `x-powered-by`; `POST /api/track` com tipo inválido → 400, corpo > 2 KB → 413, evento real → 200.
