# Campanhas por loja

A migration 1060 prepara campanhas para catálogos simples de lojas online (delivery/levantamento).
Não activa nada ao instalar. Não suporta POS, variantes, brindes nem modificadores: a activação
recusa esse catálogo. Se essas capacidades forem ligadas depois, o desconto e o banner são suspensos.

`start_store_campaign(store_id, id, increase_bps, discount_bps, ends_at, title, banner_url)` exige
sessão de dono. Uma chave UUID repetida com os mesmos parâmetros não volta a aumentar preços.
O aumento escreve preços oficiais em `store_items.price_cents_override`, apenas na loja indicada,
e regista os valores anteriores/novos com o autor em `event_log`. Não altera pedidos antigos.

A campanha aplica o desconto por unidade, em centavos, arredondando meio centavo para cima.
Exemplo: 1000 MT → tabela 1150 MT → campanha 977,50 MT. A entrega mantém a taxa normal.
Não acumula com cupões: durante a campanha o servidor ignora `referralCode`; a UI deve ocultar
o campo e não apresentar outro desconto. Após a data final (exclusiva, UTC), volta a tabela nova,
sem cron nem intervenção manual. Não chamar o novo preço de tabela «preço anterior».

`get_menu` devolve `campaign` e `list_price_cents` ao lado do `price_cents` efectivo. O componente
`components/storefront/campaign.tsx` mostra a arte, os dois preços e uma barra do **prazo**,
sem inventar stock ou procura. Refrescar o cardápio na expiração e durante a campanha.

Validação SQL local: numa transacção, aplicar a migration, executar
`supabase/tests/store_campaign.sql` e fazer ROLLBACK. Ensaiar o checkout público idempotente
e o pagamento simulado no staging da instalação antes de activar em produção.

Referência de permissões das funções: https://supabase.com/docs/guides/database/functions
