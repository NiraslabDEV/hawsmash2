-- 1131 — as observações rápidas da loja chegam ao site.
--
-- Pedido do dono (7 Nov): quem pede pelo site escolhe extras e observações
-- ("sem vegetais", "sem molho") com a mesma facilidade do balcão. O balcão já
-- tinha atalhos de observação (`store_pos_settings.config.quickNotes`, 1067),
-- editados em Definições do POS. O site passa a mostrar os mesmos: uma lista
-- só por loja, para a cozinha ler as mesmas palavras venham de onde vierem.
--
-- O get_menu passa a devolver `quick_notes` (array de texto, pode vir vazio).
-- Faz-se como na 1060 e na 1078: o get_menu anterior fica em private e este
-- acrescenta o campo por cima, sem reescrever o cardápio.
--
-- O anon continua sem SELECT em store_pos_settings (§17): só lê este array,
-- pela função SECURITY DEFINER, e só da loja do cardápio que pediu.
--
-- Portável: não traz dados de nenhuma loja. Os atalhos desta casa ficam na 1132.
-- Forward-only e idempotente.

do $$
begin
  if to_regprocedure('private.get_menu_before_quick_notes(text,text,boolean)') is null then
    alter function public.get_menu(text, text, boolean) set schema private;
    alter function private.get_menu(text, text, boolean) rename to get_menu_before_quick_notes;
  end if;
end;
$$;

revoke all on function private.get_menu_before_quick_notes(text, text, boolean)
  from public, anon, authenticated;

create or replace function public.get_menu(
  p_store_slug text,
  p_channel text default null,
  p_include_unavailable boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_menu jsonb;
  v_store_id uuid;
  v_notes jsonb;
begin
  v_menu := private.get_menu_before_quick_notes(p_store_slug, p_channel, p_include_unavailable);

  begin
    v_store_id := nullif(v_menu #>> '{store,id}', '')::uuid;
  exception when invalid_text_representation then
    v_store_id := null;
  end;

  -- Só textos não vazios, pela ordem da loja. Uma config estragada nunca
  -- impede o cardápio de abrir: no pior caso, o site fica sem atalhos.
  select coalesce(jsonb_agg(to_jsonb(btrim(e.value)) order by e.ordinality), '[]'::jsonb)
    into v_notes
    from public.store_pos_settings s
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(s.config -> 'quickNotes') = 'array'
           then s.config -> 'quickNotes' else '[]'::jsonb end
    ) with ordinality as e(value, ordinality)
   where s.store_id = v_store_id
     and btrim(e.value) <> '';

  return v_menu || jsonb_build_object('quick_notes', coalesce(v_notes, '[]'::jsonb));
end;
$$;

revoke all on function public.get_menu(text, text, boolean) from public;
grant execute on function public.get_menu(text, text, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
