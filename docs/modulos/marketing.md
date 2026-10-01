# Marketing, atribuição, campanhas e upsells

O rastreio interno relaciona visitas, carrinhos e pedidos com a sua origem. Pixel/GTM/Ads são canais adicionais; não são a fonte de verdade da receita. Este módulo reúne o funcionamento antes disperso pelos documentos de rastreio, campanhas e origens/upsells. A leitura financeira e a exportação estão em [relatórios](relatorios.md).

**Estado:** código local auditado em 26/09/2026. Credenciais, scheduler, entrega às redes e configuração publicada não foram consultados. Registos históricos de testes/staging não constituem um teste novo desta documentação.

## Perfis e fronteiras

O dono configura marketing; o menu também apresenta `/marketing` ao gerente, mas as policies de `settings` restringem o acesso efectivo. Não confundir a presença da aba com autorização de leitura/escrita. Análise/Aquisição destina-se a dono e gerente das lojas autorizadas; caixa/cozinha não têm a aba. As diferenças entre navegação e BD estão na [auditoria](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec).

O browser envia eventos públicos a `/api/track`; o servidor valida o corpo manualmente, filtra bots, resolve sessão/origem e grava `analytics_events`. Não usa Zod nesse handler e não faz uma decisão de consentimento. O consentimento dos scripts de terceiros é tratado pelo cliente em `lib/analytics/track.ts`.

## Percurso da visita até à compra

| Peça | Responsabilidade |
|---|---|
| [Middleware](../../apps/web/middleware.ts) | Emite sessão e sela o primeiro/último toque antes do JavaScript; exclui POS, TVs e APIs salvo `/api/track` |
| [Atribuição](../../apps/web/lib/attribution.ts) | Classifica canal/fonte/meio/campanha e normaliza entradas |
| [Sessão](../../apps/web/lib/analytics/session.ts) | UUID válido; valores vazios/lixo não colapsam o tráfego numa sessão “unknown” |
| [Bots](../../apps/web/lib/analytics/bots.ts) | Exclui agentes automatizados reconhecidos; testes evitam falsos positivos conhecidos |
| [Tracking do browser](../../apps/web/lib/analytics/track.ts) | Ponto central de dataLayer/fbq/gtag e `/api/track` |
| [API track](../../apps/web/app/api/track/route.ts) | Lê os cookies e insere com cliente servidor |
| [Conversões de servidor](../../apps/web/lib/server-analytics/conversions.ts) | Compra no funil e fila de entrega às redes |

`dl_session` dura 30 minutos deslizantes e é httpOnly. `dl_attr_first` conserva a descoberta durante 180 dias; `dl_attr_last`, o último toque relevante durante 30 dias. Visitas directas e navegação interna não apagam uma campanha anterior. A origem do corpo do evento não sobrepõe a origem classificada pelos cookies.

Os eventos incluem `view_menu`, `view_item`, `add_to_cart`, `begin_checkout`, `add_payment_info`, `purchase`, `lead`, `coupon_applied`, `upsell_view` e `upsell_accept`. A compra do browser é emitida no acompanhamento quando o pedido está `paid`/`approved`, com guarda de repetição. O servidor também regista compra por `record_server_purchase_event`, para não depender de o cliente manter a página aberta. Submeter o formulário não equivale a confirmar pagamento.

Após criar um pedido, `record_order_attribution` grava a origem em passo best-effort separado. As redes recebem contexto de pedido confirmado, com normalização/hash dos identificadores necessários e fila idempotente por pedido/destino. Falhar tracking ou entrega às redes não deve reverter a venda.

## Tabelas e RPCs

| Objecto | Uso |
|---|---|
| `analytics_events` | Eventos de medição; loja pode ser nula antes da escolha |
| `analytics_sessions`, `online_analytics_events` | Views normalizadas e com `security_invoker`; as antigas views de funil foram removidas |
| `order_attribution` | Primeiro/último toque ligado a pedido real |
| `conversion_jobs` | Fila de conversões externas |
| `settings` | IDs/configuração de marketing e segredos usados no servidor |
| `store_campaigns` | Campanhas de preço por loja |
| `order_upsells`, `private.order_upsell_captures` | Atribuição e captura única do upsell vendido |

Leitura: `get_funnel_metrics`, `get_attribution_report`, `get_upsell_metrics`, `get_conversion_health` e métricas financeiras do [módulo de relatórios](relatorios.md). Escrita/servidor: `record_order_attribution`, `record_server_purchase_event`, `enqueue_conversions`, `claim_conversion_jobs`, `get_conversion_context`, `complete_conversion_job`. Segredos de redes são obtidos no servidor por `get_secret_settings`.

O cron `/api/cron/conversions` escoa a fila. O callback `/api/conversions/fire` também tenta enfileirar/processar, mas não tem guard próprio de staff. O cron só verifica Bearer quando `CRON_SECRET` está definido. Estas são propriedades observadas, não recomendações de exposição; ver [crons](../referencia/crons.md) e auditoria. Nenhum scheduler existe no repositório.

## Ler origens e funil

A normalização existe em TypeScript à entrada e nos helpers SQL `private.attr_*` para leitura do histórico. O histórico de eventos não deve ser reescrito para “limpar” campanhas. Alterar uma regra exige manter as duas implementações coerentes.

| Entrada recebida | Interpretação normalizada |
|---|---|
| Fonte MetaAds e nome de campanha no meio | Facebook pago; o nome é aproveitado como campanha |
| ID numérico de campanha no campo da fonte | Fonte Facebook paga; o ID pertence à campanha |
| Nome e ID disponíveis | O nome legível prevalece |
| Nome com `+` ainda codificados | Normalização para a mesma campanha |
| Macros não substituídas ou marcadores de sanitização | Ausência, nunca origem/campanha inventada |
| `ig`, `fb`, `an`, `msg` do Meta | Instagram, Facebook, Audience Network, Messenger |

A parametrização prevista no manual de anúncios é:

```text
utm_source={{site_source_name}}&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
```

“Directo” inclui links sem referrer. Etiquetar links partilhados pela equipa permite distingui-los; não se deve redistribuir receita directa por suposição. Checkout pode superar carrinho numa sessão: o carrinho persiste mais tempo que os 30 minutos da sessão. A taxa não prova erro por ultrapassar 100%.

As comparações de tráfego/carrinho/receita servem para diagnosticar segmentação. Os números de exemplos do playbook antigo de outra instalação não são métricas desta empresa. Validar numa instalação de ensaio com uma campanha sintética, consulta de sessões distintas, eventos por etapa e uma origem normalizada única. Não usar consultas manuais de escrita em produção.

## Origem comercial e upsells

POS é identificado por `client_sale_id` ou canal `counter`. Uma entrega criada no balcão continua POS; um pedido online recebido em dinheiro continua online. QR de mesa sem identificação POS continua online. Aquisição exclui POS; os eventos de upsell do balcão não criam sessões do funil online.

O site marca acompanhamentos/upgrades aceites; o POS marca artigos adicionados nos passos de oferta. A marca acompanha apenas as unidades aceites, incluindo a fila offline. Diminuir quantidade retira primeiro unidades atribuídas; adições normais não aumentam o upsell atribuído.

A captura depois do cálculo de preços é única e best-effort. Não aceita preços/custos do browser, limita a atribuição às linhas e quantidades vendidas e não muda numa repetição, mesmo se a primeira chamada não continha upsell. Linhas ambíguas não são adivinhadas: omite-se a telemetria e mantém-se a venda.

Receita usa linhas confirmadas e desconto repartido, sem entrega. Upgrades contam apenas a diferença entre variantes, conservando adicionais/campanha. A margem bruta estimada dos acompanhamentos usa `order_items.cost_cents` congelado; custo ausente ou upgrade sem custo diferencial fica **Por apurar**. Não é lucro líquido nem prova aumento causal, que exigiria comparação controlada.

Vistas/aceitações são observacionais e deduplicadas por sessão/artigo/posição; no POS, por venda/artigo/posição. Aceitar não prova pagar. Rede, bloqueadores e offline podem reduzir vistas; a atribuição de unidades vendidas persiste com a venda. O histórico sem marca não é reconstruído a partir de `is_upsell`.

## Campanhas de preço: contrato preparado e limite da UI

A [migration 1060](../../supabase/migrations/20260923003520_1060_campanha_por_loja.sql) prepara campanhas online de delivery/levantamento em catálogos simples; não activa uma campanha ao instalar. `start_store_campaign` exige dono, loja, UUID, percentagens em basis points, prazo, título e imagem. Repetir UUID/parâmetros não reaplica o aumento; parâmetros diferentes com a mesma chave são recusados.

O aumento altera o preço oficial em `store_items.price_cents_override` só nessa loja, sem reescrever pedidos anteriores. O desconto é por unidade e arredonda meio centavo para cima. A entrega não muda. Exemplo aritmético: tabela 1000 MT, aumento de 15% → nova tabela 1150 MT, desconto de 15% → 977,50 MT. A nova tabela não deve ser chamada “preço anterior”. Depois do prazo exclusivo em UTC deixa de haver desconto, sem cron, e mantém-se a tabela reajustada.

O catálogo admitido exclui POS, brindes, adicionais e modificadores. Variantes só entram com preço base igual ao produto; uma variante incompatível suspende a campanha inteira. Durante campanha o wrapper retira `referralCode`, evitando acumulação de descontos. `get_menu` devolve a campanha, preço efectivo e `list_price_cents`.

**Limite observado:** [CampaignBanner/CampaignPrice](../../apps/web/components/storefront/campaign.tsx) existem, mas não têm importador na montra activa. O checkout actual mantém o campo de cupão e não o condiciona à campanha. O requisito de banner, actualização na expiração e ocultação de cupão não deve ser anunciado como UI entregue. A activação de campanha exige primeiro fechar/ensaiar essa integração; a documentação não modifica o código.

**Campanha de preço ≠ promoção (1113).** São dois mecanismos distintos e **não acumulam**: a campanha reescreve a tabela de preços da loja (`store_items.price_cents_override`) e o wrapper retira o `referralCode`; as [promoções](promocoes.md) (2x1, entrega grátis, cupões, desconto manual) deixam o preço em paz e abatem no total do pedido. A camada da 1113 fica **por cima** da 1060 na cadeia do `create_order`, pela mesma ordem: `create_order_store_legacy` (1113) → `create_order_store_before_promotions` (1060) → `create_order_store_before_campaign` (1013). Com campanha a correr, não há cupão nem 2x1 no pedido. A montra e o checkout das promoções têm UI entregue — o que não é verdade da campanha.

## Eventos, privacidade e verificação

`campaign.started` grava autor/loja e preços antes/depois. O processamento de conversões pode gravar `conversion.enqueue_error`; os estados detalhados ficam na fila. Eventos de funil pertencem a `analytics_events`, não são todos eventos de auditoria. A aba Marketing faz escrita directa em `settings`; não se promete um evento auditado para cada alteração desse formulário.

**Ecrãs sem marketing.** `/tv`, `/kds` e `/pos` não pedem a configuração de consentimento, não mostram o aviso de cookies e não iniciam etiqueta nenhuma — são páginas sem ninguém a navegar à frente, e o aviso tapava as senhas e o ecrã do caixa. Lista única em [`lib/analytics/surfaces.ts`](../../apps/web/lib/analytics/surfaces.ts), com teste; o `AnalyticsProvider` continua montado em todas as páginas e é ele que decide. Ver [TVs](tvs-kds.md) e [POS](pos.md).

Scripts publicitários respeitam `dl_consent`; medição first-party existe sem esse consentimento no comportamento actual. Esta descrição não é uma conclusão jurídica. Não se deve afirmar que toda a superfície pública é isenta de PII: a cadeia de conta por UUID e as policies de comprovativos têm achados abertos na [auditoria, secção 5](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec).

Testes: [analytics](../../apps/web/lib/analytics/__tests__/), [server-analytics](../../apps/web/lib/server-analytics/__tests__/), [atribuição](../../apps/web/lib/__tests__/attribution.test.ts), [funil DB](../../packages/db/tests/funil.test.ts), [tracking DB](../../packages/db/tests/tracking.test.ts), [origens](../../packages/db/tests/analysis-origins.test.ts), [campanhas SQL](../../supabase/tests/store_campaign.sql) e [e2e upsell](../../e2e/upsell.spec.ts). A suite SQL só deve ser executada no ambiente de testes apropriado; esta documentação não a executa.

O registo de 24/09/2026 reportava 973 testes unitários, 60 DB, 12 Playwright, lint/typecheck/build e reconciliação de leitura em staging. As migrations 1073–1075 eram descritas como staging, não promoção para produção. Esses resultados são evidência histórica, não novos resultados. Ver **B-111** (Análise em staging), restantes bloqueios de activação em [BLOQUEIOS](../../BLOQUEIOS.md), [manual operacional](../operacao/marketing.md) e [testes](../referencia/testes.md). A separação por loja segue o [ADR 0001](../decisions/0001-multi-unidade.md); campanhas e atribuição de upsell são candidatas a decisão própria, não ADRs inventados aqui.
