-- ============================================================================
-- Fix: trigger_set_available_on_stock() marcava available=false para QUALQUER
-- item com stock_qty=0, mesmo quando track_stock=false (stock_qty=0 é só o
-- default nesse caso — não significa "esgotado").
--
-- Efeito real descoberto: import_menu() faz UPDATE ... SET stock_qty = ...
-- no upsert (mesmo reafirmando o mesmo valor 0), o que é suficiente para
-- disparar um trigger "before update OF stock_qty" em Postgres — e a função
-- então forçava available=false em cima do available=true que o próprio
-- import_menu tinha acabado de calcular. Resultado: re-importar o cardápio
-- (idempotência, B0.2) apagava a disponibilidade de quase todos os itens
-- sem stock rastreado.
--
-- Fix: só aplicar a lógica quando track_stock = true.
-- ============================================================================

create or replace function trigger_set_available_on_stock()
returns trigger
language plpgsql
as $$
begin
  if not new.track_stock then
    return new;
  end if;

  if new.stock_qty = 0 then
    new.available := false;
  elsif new.stock_qty > 0 and not new.available then
    -- DECISÃO (mantida): não reactiva automaticamente quando stock > 0.
    -- O staff deve decidir quando tornar o item available novamente.
    new.available := false;
  end if;
  return new;
end;
$$;
