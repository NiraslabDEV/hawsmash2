# Rotas e acesso

Mapa observado na árvore local de 26 de Setembro de 2026: 30 páginas e 34 handlers API. Não comprova publicação. O detalhe funcional está nos [módulos](../README.md); V-* e R-* referem-se à [auditoria](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec).

## 1. Painel: as 16 abas

O = owner; M = manager da loja; C = cashier. A tabela descreve **guard de navegação**, não autorização irrestrita da BD. Fonte comum: `apps/web/lib/admin/nav.ts:33` e layout do painel. Kitchen é recusado neste painel.

| Rota / aba | Perfis UI | Função e principais acessos |
|---|---|---|
| /pedidos | O/M/C | Quadro paginado, filtros, conciliação needs_review, comprovativo assinado, advance_order e reprint |
| /cardapio | O/M | Catálogo/variantes/adicionais, store_items, fotos menu-photos; CRUD directo em várias tabelas. O suporte a modificadores na BD/site não implica editor nesta aba |
| /mesas | O/M | CRUD tables por loja e QR /m/[token]; não é a conta/pagamento do POS |
| /caixa | O/M/C | get_cash_dashboard, abrir/fechar turno, movimentos, PDF/email; lista de cash_day_closes |
| /estoque | O/M | Produtos, ingredientes, movimentos, fichas e CMV; custo/ficha editáveis pelo O |
| /analise | O/M | Vendas Todos/Online/POS, aquisição, atribuição, upsells, exportação |
| /feedback | O/M | admin_list_feedbacks |
| /lista-espera — Clientes | O/M | Pesquisa/paginação customers, moradas e histórico; restrições efectivas em R-06 |
| /marketing | O/M | IDs/tokens e configuração; limitações de escrita de settings em R-06 |
| /lojas | O/M | O configura loja, horário, zonas/pagamento; M opera kill switch; Google Place ID no trabalho local |
| /definicoes-pos — POS | O/M | get/save_pos_settings, meios de pagamento/upsell/notas, layout/vias, copiar definições |
| /tvs | O/M | store_tvs, biblioteca tv_media, save/delete_store_tv, register/delete_tv_media |
| /equipa | O | Contas, perfil/lojas/PIN, revogação, password via API |
| /aparencia | O | get_brand/update_brand e assets da identidade |
| /sistema | O/M | get_system_status/list_system_alerts/get_conversion_health |
| /definicoes | O | SettingsSection/PaysuiteSection/PromoSection; campos herdados ainda presentes (V-06) |

Todas são `page.tsx` sob `apps/web/app/(admin)`. As páginas cardapio/mesas/marketing/definicoes delegam em componentes *-section.tsx do grupo. Não existe uma página separada /clientes.

## 2. Restantes 14 páginas

| Rota | Público/perfil | Percurso / fonte |
|---|---|---|
| / | anon | Escolha de loja; `apps/web/app/(public)/page.tsx:32` |
| /l/[slug] | anon | Storefront da loja, /api/menu; `apps/web/app/(public)/l/[slug]/page.tsx:35` |
| /menu | anon | Redirect por hs_store/loja por omissão; `apps/web/app/(public)/menu/page.tsx:23` |
| /upsell | anon | Ofertas de upgrade/companhia; página pública upsell |
| /checkout | anon + conta opcional por cookie | Menu, dados/horário/zona, conta/moradas, pagamento e comprovativo |
| /order-status/[orderId] | portador de UUID | Estado, polling, bind de conta e feedback; pressuposto de posse em V-01 |
| /payment/return/[orderId] | portador de UUID | Consulta/retorno de pagamento e encaminhamento para estado |
| /m/[token] | portador de token da mesa | get_table_by_token, menu dine_in, pedido QR na loja da mesa |
| /pedido-assistido | anon | Revê fragmento preparado por agente; só substitui carrinho após confirmação humana |
| /tv/[store]/menu | anon | get_store_board, actualização 60 s |
| /tv/[store]/senhas | anon | get_store_queue, polling 5 s |
| /tv/[store]/[screen] | anon | get_tv_screen/config 30 s, heartbeat, cache de media, auto-update |
| /pos | staff + terminal/PIN | Venda, pedidos/delivery, senhas, mesas, caixa e disponibilidade; backend aceita kitchen em login, ver V-03 |
| /login | público, cria sessão staff | signInWithPassword e redirect interno validado |

Não há rota cron de página: os cinco crons são endpoints HTTP. Não há rota KDS.

Além destas páginas/APIs, `apps/web/app/manifest.ts:7` serve a rota especial **/manifest.webmanifest**, com scope/start_url do POS. O service worker `apps/web/public/pos-sw.js` é um asset estático.

## 3. Todos os 34 endpoints HTTP

Prefixo comum **/api**; ficheiro correspondente em **apps/web/app/api**. Os três emails legados têm `route.tsx`; os outros usam `route.ts`. “Público” descreve ausência de login de staff, não autorização para uma instalação aceitar qualquer efeito.

| Endpoint | Método(s) | Porta de entrada / efeito |
|---|---|---|
| /account | GET, POST | Cookie hs_acc para ler/sair; bind por orderId sem prova adicional (V-01) |
| /account/address | POST, DELETE | Cookie/token; account_save_address/account_delete_address |
| /account/code | POST | Telefone/código; account_request_code/account_verify_code |
| /agents/tools | POST, OPTIONS | Flag/origem/limites; ferramentas públicas sem criar pedidos |
| /attach-proof | POST | UUID/path → attach_payment_proof; aviso ao dono best-effort |
| /cash-sessions/[id]/report | GET | Sessão por cookie e RLS → PDF |
| /conversions/fire | POST | Público; contexto/conversões server-side; rever autorização/contrato no módulo |
| /create-order | POST | Público; create_order + atribuição server-side |
| /cron/alerts | GET | Bearer condicional → consulta alertas/email |
| /cron/conversions | GET | Bearer condicional → outbox de conversões |
| /cron/digest | GET | Bearer condicional → digest diário |
| /cron/monthly | GET | Bearer obrigatório → resumo mensal/Google; ficheiro local preexistente não commitado |
| /cron/reconcile | GET | Bearer obrigatório → consulta pagamentos por loja/cursor |
| /emails/send-approval-email | POST | Payload caller, sem autenticação; SMTP (V-08/V-12/R-01) |
| /emails/send-order-email | POST | Destinatário/assunto/HTML caller, sem autenticação (R-01) |
| /emails/send-rejection-email | POST | Payload caller, sem autenticação (R-01) |
| /emails/send-cash-close-email | POST | Sessão cookie/RLS; destinatário e relatório do servidor |
| /emails/send-cash-day-email | POST | Sessão cookie/RLS; destinatário e relatório do servidor |
| /feedback | POST | Público; submit_feedback |
| /health | GET | Público; disponibilidade HTTP, não prova ponta a ponta |
| /mcp | POST, GET, DELETE, OPTIONS | SDK Streamable HTTP, flag/origem/limites; ver ADR 0005 |
| /menu | GET | Público; get_menu por loja/canal |
| /order-status/[orderId] | GET | Público por UUID; get_order_status |
| /payments | POST | Público; create_order, claim_online_checkout e fornecedor da loja/método |
| /payments/verify | POST | UUID → consulta fornecedor/confirmador comum |
| /pos/login | POST | Dispositivo/cartão/PIN, Zod e travão BD; emite sessão pessoal Supabase |
| /reports/export-sales | GET | Bearer/getUser; RPC sob identidade do utilizador, O/M e consolidado só O |
| /staff | POST | Bearer + owner activo; cria acesso por Admin Auth |
| /staff/[userId]/password | PATCH | Bearer + owner activo; reset e auditoria |
| /stores | GET | Público; list_public_stores |
| /track | POST | Validação manual/bots/sessão/atribuição; analytics_events server-side. Consentimento de marketing é tratado no cliente |
| /version | GET | Público; versão de build para actualização de terminais |
| /waitlist | POST | Público; join_waitlist |
| /webhooks/paysuite | POST | HMAC e confronto de referência/valor/método/pedido; confirmador comum |

Fonte da autorização de staff: handlers staff/export; o middleware da aplicação trata atribuição e cookies de medição, **não é um guard de autenticação global**. Os handlers públicos legados usam cliente servidor com service role; o canal de agentes usa anon, sem cookies, como exige o ADR 0005.
