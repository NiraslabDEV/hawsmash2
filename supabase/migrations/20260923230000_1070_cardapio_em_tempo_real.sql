-- HAWSMASH 2.0 — 1070: o POS vê um "esgotado" no instante em que é marcado.
--
-- O POS relia o cardápio de 2 em 2 minutos e nunca se recarrega à mão (é um
-- quiosque). Marcar um produto como esgotado no painel, ou noutro terminal,
-- deixava-o à venda no balcão até ao ciclo seguinte.
--
-- A disponibilidade vem de `store_items` (a loja) e de `menu_items` (o
-- catálogo), por isso as duas entram na publicação do realtime. O evento só
-- dispara um refetch do get_menu (CLAUDE §11.3) — nunca constrói estado — e o
-- RLS de cada tabela continua a decidir quem recebe o quê. O polling de 15 s
-- no POS assume se o realtime cair.
--
-- Idempotente: a publicação já pode ter as tabelas.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['store_items', 'menu_items'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
