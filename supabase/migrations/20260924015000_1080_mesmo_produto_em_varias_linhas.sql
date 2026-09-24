-- 1080 — o mesmo produto em várias linhas da venda de balcão, e a variante no papel.
--
-- Caso real, 24 Set: um pedido de 6 Classic — 5 HAW e 1 WAGYU — e 4 batatas,
-- pago por e-Mola, recusado duas vezes com `duplicate_item`. Não era o e-Mola:
-- o erro só aparecia no painel do pagamento porque é lá que se finaliza. O
-- carrinho do POS separa, e bem, HAW de WAGYU (preços diferentes) e um "sem
-- cebola" de um normal (cozinha diferente). A create_counter_sale_unlocked da
-- 1023 recusava o mesmo produto em duas linhas e revertia a venda inteira: sem
-- pedido, sem pagamento registado, sem talão. Em dinheiro era igual, e uma
-- venda destas feita sem rede nunca sincronizava.
--
-- O que muda:
--
-- 1. Sai a verificação `duplicate_item`. O stock continua certo: cada linha
--    relê e trava a sua linha de store_items na mesma transacção, vê o que a
--    linha anterior deixou, e o livro de movimentos grava por linha. A ficha
--    técnica (1025), a anulação e o online já somavam por produto.
--
-- 2. O talão completo (1064) passa a dizer a variante no nome do artigo:
--    "5x Classic Smash HAW" e "1x Classic Smash WAGYU". Até aqui um WAGYU saía
--    como "Classic Smash" — e no modelo Cozinha, sem preços, a chapa não o
--    distinguia do HAW. Vai no `name`, e não num campo novo, para sair já com
--    o bridge que está nas lojas, sem .exe novo. É o nome que o POS imprime
--    sem rede (`resolveName`, apps/web/lib/pos/cart.ts).
--
-- Porque é um remendo e não a função inteira outra vez: a 1077 (extras no
-- balcão, ainda por sair) redefine estas mesmas duas funções e já traz as duas
-- correcções à sua maneira. Isto muda só o texto que nomeia e salta o que já
-- estiver corrigido, por isso não pisa a 1077 em nenhuma ordem de aplicação.
-- Se o texto esperado não estiver lá, falha alto e não muda nada.
--
-- Numerada 1080 mas com hora anterior à 1077, de propósito: vai para produção
-- antes das 1077–1079, que ainda estão em curso.
--
-- Forward-only: substitui duas funções, sem tocar em dados.

-- ---------------------------------------------------------------------------
-- 1. Venda de balcão: o mesmo produto em várias linhas
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
  v_matches integer;
  v_check constant text :=
    'if\s+v_menu_item_id\s*=\s*any\s*\(\s*v_seen_items\s*\)\s*then\s+'
    || 'raise\s+exception\s+''duplicate_item:%''\s*,\s*v_menu_item_id\s+using\s+errcode\s*=\s*''P0007''\s*;\s*'
    || 'end\s+if\s*;\s*'
    || 'v_seen_items\s*:=\s*array_append\s*\(\s*v_seen_items\s*,\s*v_menu_item_id\s*\)\s*;';
begin
  v_def := pg_catalog.pg_get_functiondef(
    'public.create_counter_sale_unlocked(jsonb)'::pg_catalog.regprocedure
  );

  if strpos(v_def, 'duplicate_item') = 0 then
    raise notice '1080: create_counter_sale_unlocked já aceita o mesmo produto em várias linhas';
    return;
  end if;

  select count(*) into v_matches from regexp_matches(v_def, v_check, 'g');
  if v_matches <> 1 then
    raise exception '1080: a verificação duplicate_item não tem a forma esperada; nada foi alterado';
  end if;

  v_new := regexp_replace(
    v_def,
    v_check,
    '-- (1080) O mesmo produto pode vir em várias linhas: HAW e WAGYU, com e sem nota.'
  );
  if strpos(v_new, 'duplicate_item') > 0 then
    raise exception '1080: a verificação duplicate_item continua na função; nada foi alterado';
  end if;

  execute v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Talão completo: a variante no nome do artigo
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_matches integer;
  v_name constant text := '''name'',\s*oi\.name_snapshot\s*,';
begin
  v_def := pg_catalog.pg_get_functiondef(
    'private.build_full_ticket_payload(uuid, text)'::pg_catalog.regprocedure
  );

  -- A 1077 manda a variante num campo próprio; esta, se já correu, no nome.
  if strpos(v_def, 'variant_name_snapshot') > 0 then
    raise notice '1080: o talão completo já leva a variante';
    return;
  end if;

  select count(*) into v_matches from regexp_matches(v_def, v_name, 'g');
  if v_matches <> 1 then
    raise exception '1080: o nome do artigo no talão não tem a forma esperada; nada foi alterado';
  end if;

  -- "Classic Smash" + "WAGYU" → "Classic Smash WAGYU". Sem repetir a variante
  -- quando o nome já a traz, como o POS faz.
  execute regexp_replace(v_def, v_name, $r$'name', case
            when nullif(btrim(oi.variant_name_snapshot), '') is null
              or strpos(lower(oi.name_snapshot), lower(btrim(oi.variant_name_snapshot))) > 0
            then oi.name_snapshot
            else oi.name_snapshot || ' ' || btrim(oi.variant_name_snapshot)
          end,$r$);
end;
$$;

notify pgrst, 'reload schema';
