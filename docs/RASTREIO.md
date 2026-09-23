# Rastreio first-party — como funciona e como se lê

> **Origem:** o playbook do SLICE (`SLICE-pizzaria/docs/rastreio-playbook.md`), afinado com dados
> reais de anúncios em 2026-09. Aqui foi **fundido** com o que o HAWSMASH já tinha — não copiado:
> este motor já guardava primeiro e último toque e a atribuição por pedido (1029), coisa que o SLICE
> não tem. Do SLICE veio o que faltava: normalização do lixo dos anúncios, filtro de robôs, validação
> da sessão, etapa do carrinho e o funil por origem e campanha (1066).

**A fonte de verdade é a base de dados**, não o pixel. GTM/Meta/Ads continuam por cima, com
consentimento, para os ad networks.

---

## 1. As peças

| Peça | Faz |
|---|---|
| [`apps/web/middleware.ts`](../apps/web/middleware.ts) | emite `dl_session` (30 min deslizantes, httpOnly) e sela a origem em `dl_attr_first` (180 d) / `dl_attr_last` (30 d). Cobre as páginas públicas **e** `/api/track` |
| [`apps/web/lib/attribution.ts`](../apps/web/lib/attribution.ts) | **o cérebro**: classifica canal/fonte/meio/campanha e normaliza o lixo dos anúncios. Puro, testado |
| [`apps/web/lib/analytics/session.ts`](../apps/web/lib/analytics/session.ts) | valida o id de sessão — `'unknown'`, vazio ou lixo nunca passam |
| [`apps/web/lib/analytics/bots.ts`](../apps/web/lib/analytics/bots.ts) | robôs fora do funil (sem apanhar telemóveis CUBOT) |
| [`apps/web/lib/analytics/track.ts`](../apps/web/lib/analytics/track.ts) | **único** sítio que toca `dataLayer`/`fbq`/`gtag` e chama `/api/track` |
| [`apps/web/app/api/track/route.ts`](../apps/web/app/api/track/route.ts) | filtra robôs → lê sessão e origem dos cookies → insere com service role |
| `analytics_events` | eventos, append-only, com `store_id` e origem classificada no servidor |
| `order_attribution` (1029) | origem de cada **pedido**, escrita logo a seguir ao `create_order` |
| `analytics_sessions` (1066) | uma linha por sessão, já normalizada. `security_invoker`: respeita a RLS da loja |
| `get_funnel_metrics(p_from, p_to, p_store_id)` (1066) | funil + funil por origem/campanha, para a aba **Análise → Aquisição** |
| `get_attribution_report(...)` (1029) | receita por canal/campanha a partir de **pedidos reais**, não do pixel |

Eventos: `view_menu` · `view_item` · `add_to_cart` · `begin_checkout` · `add_payment_info` ·
`purchase` (só em `/order-status`, com o pedido `paid`/`approved`, guard duplo) · `lead` · `coupon_applied`.

---

## 2. Regras

1. **A origem classifica-se no servidor.** Só o middleware vê o `Referer` e a query string da
   entrada. O `utm` que o browser manda no corpo é reforço, nunca manda.
2. **Normalizar em dois sítios.** O TS normaliza à entrada (dados novos nascem limpos); o SQL
   (`private.attr_*`) repete a mesma tabela para o histórico já gravado — que é append-only e **nunca
   se reescreve com `UPDATE`**. Mexer num obriga a mexer no outro; o TS é a fonte de verdade.
3. **Loja é dimensão, e isolamento é regra.** A RPC segue a RLS de `analytics_events`: o gerente vê
   só as suas lojas; o tráfego antes da escolha de loja (`store_id` nulo) só o dono o vê; "Todas" é
   só do dono. Caixa e cozinha não lêem o funil. Testado em `packages/db/tests/funil.test.ts`.
4. **Views com `security_invoker`.** Uma view sem isso corre como o dono e salta a RLS — foi o que as
   antigas `funnel_rates`/`funnel_by_source` faziam (removidas na 1066).
5. **`drop view` apaga os grants.** Recriar uma view obriga a re-conceder. Se a aba Análise der erro
   logo a seguir a uma migration de views, é quase de certeza isto (já aconteceu: 1019).

---

## 3. Armadilhas já pagas (no SLICE)

**Os UTM dos anúncios do Meta chegam podres.** 14 linhas no painel que eram 5 origens:

| Chega | É | Fica |
|---|---|---|
| `utm_source=MetaAds&utm_medium=PIZZA DELIVERY` | nome da campanha no campo do meio | `facebook / cpc / pizza delivery` |
| `utm_source=120250536398130239` | id da campanha no campo da fonte | `facebook / cpc`, id na campanha |
| `utm_campaign=1202…&utm_medium=New Traffic Ad` | id na campanha, nome no meio | **o nome ganha** |
| `New%2BTraffic%2BAd` vs `New Traffic Ad` | `+` por descodificar | a mesma campanha |
| `{{campaign.id}}`, `{{adset.name}}`, `--sanitized--` | macro por substituir / proxy | **ausência**, não valor |
| `ig`, `fb`, `an`, `msg` | `{{site_source_name}}` | instagram / facebook / audience_network / messenger, pago |

Um placeholder é **ausência de valor**, e a limpeza corre nos **três** campos (fonte, meio, campanha).
O meio só pode ser um meio conhecido; o resto é nome de campanha no sítio errado.

**"Directo" não é lixo — é a caixa preta.** No SLICE eram 16 das 20 vendas: links partilhados sem
referrer. Abre-se etiquetando os links que a equipa envia (`?utm_source=whatsapp&utm_medium=social`).

**Checkouts > carrinhos não é bug.** O carrinho vive no browser e a sessão expira aos 30 min: quem
volta mais tarde faz `begin_checkout` sem `add_to_cart` nessa sessão. A taxa carrinho→checkout pode
passar de 100%. É cliente que volta — não "corrigir".

**Muito tráfego com carrinho a zero é segmentação.** No SLICE, os anúncios traziam 91% das sessões e
0% da receita: 0,3% punha algo no carrinho contra 26% do Instagram orgânico. É o que a tabela
**Funil por Origem** existe para mostrar.

---

## 4. UTM nos anúncios do Meta

No Ads Manager → *Parâmetros de URL*:

```
utm_source={{site_source_name}}&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
```

O código aguenta o formato errado — mas é melhor não precisar.

---

## 5. Validar (antes de dizer que está pronto)

```sql
-- 1. Há sessões reais, e não uma só?
select count(*) from analytics_sessions;

-- 2. Os eventos todos aparecem?
select type, count(*), count(distinct session_id) from analytics_events
where session_id <> 'unknown' group by type;

-- 3. A origem está normalizada? (sem {{, --sanitized--, nem ids numéricos na fonte)
select channel, source, medium, campaign, count(*) from analytics_sessions
group by 1,2,3,4 order by 5 desc;

-- 4. A RPC responde ao papel que o painel usa? (com sessão de dono)
select public.get_funnel_metrics(now() - interval '7 days');
```

No browser: abrir o site com `?utm_source=MetaAds&utm_medium=CAMPANHA%20TESTE` e confirmar na
Análise que aparece como **Redes sociais (pago) · facebook / cpc · campanha teste** — uma linha só.

---

## 6. Privacidade

`dl_session` e `dl_attr_*` são first-party, opacos, sem PII — medição interna, existem sem
consentimento de marketing. GTM/Pixel/Ads só carregam depois do "Aceitar" (`dl_consent=granted`).
Nenhuma RPC pública devolve morada, comprovativo ou pagamento.
