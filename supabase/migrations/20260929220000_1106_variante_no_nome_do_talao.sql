-- 1106 — a variante volta ao nome do artigo no talão completo.
--
-- A 1077 redefiniu private.build_full_ticket_payload e passou a mandar a
-- variante só no campo `variant`, com o `name` limpo ("Classic Smash"). A
-- bridge nova junta os dois; a que está nas lojas não conhece o campo e
-- imprime o nome sozinho — um WAGYU volta a sair na cozinha como o HAW. Foi
-- precisamente o que a 1080 evitou ao pôr a variante no `name`.
--
-- Esta repõe a regra da 1080 por cima da 1077: "Classic Smash WAGYU" no `name`
-- E a variante no campo `variant`. A bridge antiga lê o nome certo; a nova
-- (`itemName`, packages/receipt/src/tickets.ts) vê que o nome já traz a
-- variante e não a repete.
--
-- Mesmo método da 1080: muda só o texto que nomeia o artigo e salta se já
-- estiver feito. Se o texto esperado não estiver lá, falha alto e não muda
-- nada.
--
-- Forward-only: substitui uma função, sem tocar em dados.

do $$
declare
  v_def text;
  v_matches integer;
  v_name constant text := '''name'',\s*oi\.name_snapshot\s*,';
begin
  v_def := pg_catalog.pg_get_functiondef(
    'private.build_full_ticket_payload(uuid, text)'::pg_catalog.regprocedure
  );

  if strpos(v_def, '|| '' '' || btrim(oi.variant_name_snapshot)') > 0 then
    raise notice '1106: o talão completo já leva a variante no nome';
    return;
  end if;

  select count(*) into v_matches from regexp_matches(v_def, v_name, 'g');
  if v_matches <> 1 then
    raise exception '1106: o nome do artigo no talão não tem a forma esperada; nada foi alterado';
  end if;

  execute regexp_replace(v_def, v_name, $r$'name', case
            when nullif(btrim(oi.variant_name_snapshot), '') is null
              or strpos(lower(oi.name_snapshot), lower(btrim(oi.variant_name_snapshot))) > 0
            then oi.name_snapshot
            else oi.name_snapshot || ' ' || btrim(oi.variant_name_snapshot)
          end,$r$);
end;
$$;

notify pgrst, 'reload schema';
