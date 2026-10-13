# Migração e cutover

Plano original preservado. O script actual importa categorias/produtos, pedidos e itens e agrega clientes por telefone; NÃO importa feedback, lista de espera ou fechos antigos. Ver auditoria R-04: apagar/recriar itens não é transaccional (um delete falhado já pára antes do insert) e, desde 26/09, `--apply` numa base remota exige `--i-know-this-is-live`. Cutover exige backup, dry-run e reconciliação.

## O que já foi importado (30/09/2026)

A importação **foi executada** na base onde a loja vende ([ADR 0008](../decisions/0008-staging-passa-a-live.md)), para Maputo: **1024 pedidos, 2128 linhas de itens, 1.277.820,00 MT e 511 clientes**, reconciliados com o 1.0 (B-010). O cardápio ficou de fora de propósito — o 2.0 já tinha o seu, com fotos e preços por loja.

Três mudanças no script, no mesmo dia, que explicam porque é que isto foi seguro:

- **`--sem-cardapio`** importa só pedidos e clientes. Sem a flag, o script apagava e recriava os produtos, o que numa base a facturar significaria perder fotos, preços por loja e ligações de estoque.
- **O dry-run valida todos os registos antes de escrever** — não só os primeiros. Um pedido com um estado, um canal ou um telefone que a base nova não aceita aparece no relatório **antes** de qualquer escrita, não a meio dela.
- **`--apply` numa base remota exige `--i-know-this-is-live`**, desde 26/09.

Os 73 pedidos de ensaio de 19/08 a 02/09 (`MPT-`/`MTL-`, 51.739 MT, 20 na Matola) são anteriores a esta importação e **contam nos relatórios**. O dono confirmou que são ensaio; retirá-los exige dry-run e cópia antes. O 1.0 continua no ar no endereço Railway dele, sem domínio, e não se apaga durante 90 dias.

## Plano original, preservado da spec

O plano abaixo é o texto original e continua a descrever o alcance pretendido do importador — maior do que o que o script faz hoje. A cadeia de cutover (domínio, read-only, 90 dias) manteve-se; a ordem dos passos não, porque o domínio passou para o 2.0 antes desta importação.

## 15. MIGRAÇÃO DO HAWSMASH 1.0

O 1.0 continua a vender **até ao dia do cutover**. Nada pára.
1. `scripts/import-hawsmash-1.ts` — lê o Supabase antigo (`tsrgileifpiaiicwjfar`) e importa para o novo:
   `products`/`product_categories` → `menu_items`/`menu_categories` (+ `store_items` nas duas lojas);
   `orders`/`order_items` → `orders` com `store_id = maputo`, preservando `order_number` e `created_at`;
   `order_feedback`, `waitlist`, `caixa_fechamentos` (histórico), telefones → `customers` agregados.
2. **Dry-run obrigatório** com relatório de contagens antes de escrever.
3. Cutover: domínio aponta para o 2.0; o 1.0 fica **read-only** e arquivado (não apagar durante 90 dias).
4. Preços de referência do 1.0 (Classic 300/400, Double 400/500, Brisket 450/500, Signature 600, Nata 90/500,
   Chips 150, entrega 150 MT) entram como **seed inicial** — a partir daí o preço vive na BD, por loja.
