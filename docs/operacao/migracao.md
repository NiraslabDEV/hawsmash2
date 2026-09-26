# Migração e cutover

Plano original preservado. O script actual importa categorias/produtos, pedidos e itens e agrega clientes por telefone; NÃO importa feedback, lista de espera ou fechos antigos. Ver auditoria R-04: apagar/recriar itens não é transaccional e a flag de confirmação anunciada não foi implementada. Nenhuma importação foi executada nesta revisão. Cutover exige backup, dry-run e reconciliação.

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
