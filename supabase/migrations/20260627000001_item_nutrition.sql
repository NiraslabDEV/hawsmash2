-- ============================================================================
-- Descrição, calorias aproximadas e alérgenos por prato.
--
-- Porquê campos próprios e não tudo em `description`: a descrição também é
-- mostrada no cartão da lista, onde só cabem duas linhas. Calorias e alérgenos
-- só fazem sentido na ficha do prato — misturá-los na descrição entupiria a
-- lista inteira.
--
-- ⚠️ AVISO IMPORTANTE PARA A EQUIPA
-- Estes valores foram redigidos a partir do NOME de cada prato, não das
-- receitas reais da cozinha. As calorias são estimativas grosseiras e os
-- alérgenos são os que um prato assim normalmente tem. ANTES DE PUBLICITAR
-- ISTO COMO INFORMAÇÃO OFICIAL, a cozinha tem de rever prato a prato — sobre-
-- tudo os alérgenos, que são matéria de segurança alimentar. Por isso a lista
-- é declarativa ("contém") e nunca afirma ausência ("não contém"), e a loja
-- mostra sempre o aviso para o cliente confirmar com a equipa.
-- ============================================================================

alter table public.menu_items
  add column if not exists calories_kcal int check (calories_kcal is null or calories_kcal >= 0),
  add column if not exists allergens text[] not null default '{}';

comment on column public.menu_items.calories_kcal is
  'Estimativa por dose, para orientação do cliente. Não é valor laboratorial.';
comment on column public.menu_items.allergens is
  'Alérgenos que o prato CONTÉM. Lista declarativa — nunca afirmar ausência.';

do $$
declare
  v jsonb := jsonb_build_object(
    'Bacalhau Assado', jsonb_build_object(
      'd', 'Lombo de bacalhau assado no forno com batata, cebola, pimentos e azeitonas.',
      'k', 700, 'a', array['peixe']),
    'Bacalhau com Natas', jsonb_build_object(
      'd', 'Bacalhau desfiado com natas e batata, gratinado no forno. Serve duas pessoas.',
      'k', 950, 'a', array['peixe','leite']),
    'Bitoque', jsonb_build_object(
      'd', 'Bife de vaca grelhado com ovo estrelado, batata frita e salada.',
      'k', 850, 'a', array['ovo','leite']),
    'Fillet de Carne', jsonb_build_object(
      'd', 'Lombo de vaca grelhado com molho de natas e cogumelos, puré e legumes salteados.',
      'k', 900, 'a', array['leite']),
    'Fillet de Peixe Grelhado', jsonb_build_object(
      'd', 'Filete de peixe grelhado com puré de batata e legumes.',
      'k', 600, 'a', array['peixe','leite']),
    'Picanha Grelhada', jsonb_build_object(
      'd', 'Picanha na brasa, no ponto, com arroz, feijão preto e batata.',
      'k', 1000, 'a', array[]::text[]),
    'Camarão Grelhado', jsonb_build_object(
      'd', 'Camarão na grelha com alho e limão, acompanhado de batata frita.',
      'k', 550, 'a', array['crustáceos']),
    'Camarão Alinho', jsonb_build_object(
      'd', 'Camarão salteado em azeite e alho, servido com pão torrado.',
      'k', 480, 'a', array['crustáceos','glúten']),
    'Strogonoff de Carne com Arroz', jsonb_build_object(
      'd', 'Tiras de vaca em molho cremoso de natas e tomate, com arroz branco.',
      'k', 800, 'a', array['leite']),
    'Tomahawk 500 gr', jsonb_build_object(
      'd', 'Corte tomahawk de 500 g grelhado com temperos especiais, legumes e manteiga de ervas.',
      'k', 1200, 'a', array['leite']),
    'Rib Eye Swiss Butter', jsonb_build_object(
      'd', 'Rib eye grelhado com molho cremoso de manteiga e ervas. Batata, salada e pão.',
      'k', 1150, 'a', array['leite','glúten']),
    'Penne Alfredo', jsonb_build_object(
      'd', 'Penne com frango em molho alfredo de natas e parmesão, com crocante de queijo.',
      'k', 950, 'a', array['glúten','leite','ovo']),
    'Tagliatelle com Camarão', jsonb_build_object(
      'd', 'Tagliatelle com camarão salteado, tomate cereja, alho e ervas frescas.',
      'k', 880, 'a', array['glúten','crustáceos','ovo']),
    'Smash Single Burguer', jsonb_build_object(
      'd', 'Smash de vaca com cheddar, pickles e cebola em pão brioche, com batata frita.',
      'k', 780, 'a', array['glúten','leite','ovo']),
    'Smash Burguer c/ Ovo', jsonb_build_object(
      'd', 'Smash de vaca com ovo estrelado e cheddar derretido em pão brioche.',
      'k', 820, 'a', array['glúten','leite','ovo']),
    'Smash Duplo', jsonb_build_object(
      'd', 'Dois smash de vaca, duplo cheddar e cebola caramelizada em pão brioche.',
      'k', 1050, 'a', array['glúten','leite','ovo']),
    'Smoked Brisket Smash Burguer', jsonb_build_object(
      'd', 'Smash de vaca com brisket fumado, cheddar e molho da casa em pão brioche.',
      'k', 1100, 'a', array['glúten','leite','ovo']),
    'Tosta Pão de Água', jsonb_build_object(
      'd', 'Pão de água tostado na chapa, com manteiga.',
      'k', 220, 'a', array['glúten','leite']),
    'Prego no Pão', jsonb_build_object(
      'd', 'Bife de vaca no pão com ovo e queijo, acompanhado de batata frita.',
      'k', 760, 'a', array['glúten','leite','ovo']),
    'Tosta Mista', jsonb_build_object(
      'd', 'Tosta de fiambre e queijo em pão de forma, com batata frita.',
      'k', 520, 'a', array['glúten','leite']),
    'Tosta de Queijo Cheddar com Pastrami', jsonb_build_object(
      'd', 'Pão rústico com cheddar derretido e pastrami fatiado.',
      'k', 640, 'a', array['glúten','leite']),
    'Salada Caesar', jsonb_build_object(
      'd', 'Alface, parmesão, croutons e molho caesar.',
      'k', 420, 'a', array['glúten','leite','ovo','peixe']),
    'Salada Grega', jsonb_build_object(
      'd', 'Tomate, pepino, cebola roxa, azeitonas e queijo feta com azeite.',
      'k', 320, 'a', array['leite']),
    'Salada de Frango ou Atum', jsonb_build_object(
      'd', 'Salada fresca com a proteína à sua escolha: frango grelhado ou atum.',
      'k', 380, 'a', array['peixe']),
    'Pequeno-Almoço Casa do Bom Pasteleiro', jsonb_build_object(
      'd', 'Ovo à sua escolha, pão ou torrada e até 5 acompanhamentos incluídos. Servido todo o dia.',
      'k', 650, 'a', array['ovo','glúten','leite'])
  );
  v_name text;
  v_row  jsonb;
begin
  for v_name in select jsonb_object_keys(v)
  loop
    v_row := v -> v_name;
    update menu_items
       set description    = v_row ->> 'd',
           calories_kcal  = (v_row ->> 'k')::int,
           allergens      = array(select jsonb_array_elements_text(v_row -> 'a'))
     where name = v_name;
  end loop;
end $$;

-- ── get_menu: passa a devolver calorias e alérgenos (campos públicos) ───────
create or replace function public.get_menu(p_channel text default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_s record;
begin
  if p_channel is not null and p_channel not in ('delivery', 'dine_in') then
    raise exception 'invalid_channel' using errcode = 'P0050';
  end if;

  select * into v_s from settings where id = 1;

  return jsonb_build_object(
    'accepting_orders',  v_s.accepting_orders,
    'payment_provider',  v_s.payment_provider,
    'mpesa_number',      v_s.mpesa_number,
    'mpesa_name',        v_s.mpesa_name,
    'emola_number',      v_s.emola_number,
    'emola_name',        v_s.emola_name,
    'promo_banner_url',  v_s.promo_banner_url,
    'promo_code',        v_s.promo_code,
    'marketing', jsonb_build_object(
      'gtm_container_id',      v_s.gtm_container_id,
      'meta_pixel_id',         v_s.meta_pixel_id,
      'ga4_measurement_id',    v_s.ga4_measurement_id,
      'gads_conversion_id',    v_s.gads_conversion_id,
      'gads_conversion_label', v_s.gads_conversion_label
    ),
    'categories', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',        c.id,
          'name',      c.name,
          'station',   c.station,
          'sort',      c.sort,
          'photo_url', c.photo_url,
          'items', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'id',            i.id,
                'name',          i.name,
                'description',   i.description,
                'price_cents',   i.price_cents,
                'photo_url',     i.photo_url,
                'available',     i.available,
                'calories_kcal', i.calories_kcal,
                'allergens',     to_jsonb(i.allergens),
                'variants', (
                  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'id',         v.id,
                      'name',       v.name,
                      'price_cents', v.price_cents,
                      'is_default', v.is_default
                    ) order by v.sort
                  ), '[]'::jsonb)
                  from menu_item_variants v
                  where v.menu_item_id = i.id and v.active = true
                ),
                'addons', (
                  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'id',          a.id,
                      'name',        a.name,
                      'price_cents', a.price_cents
                    ) order by a.sort
                  ), '[]'::jsonb)
                  from menu_addons a
                  where a.menu_item_id = i.id and a.active = true
                ),
                'modifier_groups', (
                  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'id',                g.id,
                      'name',              g.name,
                      'selection_type',    g.selection_type,
                      'min_select',        g.min_select,
                      'max_select',        g.max_select,
                      'free_quantity',     g.free_quantity,
                      'extra_price_cents', g.extra_price_cents,
                      'options', (
                        select coalesce(jsonb_agg(
                          jsonb_build_object(
                            'id',          o.id,
                            'name',        o.name,
                            'price_cents', o.price_cents
                          ) order by o.sort
                        ), '[]'::jsonb)
                        from menu_modifier_options o
                        where o.group_id = g.id and o.active = true
                      )
                    ) order by g.sort
                  ), '[]'::jsonb)
                  from menu_modifier_groups g
                  where g.menu_item_id = i.id and g.active = true
                )
              ) order by i.sort
            ), '[]'::jsonb)
            from menu_items i
            where i.category_id = c.id
              and i.available = true
              and (
                p_channel is null
                or (p_channel = 'delivery' and i.available_delivery)
                or (p_channel = 'dine_in' and i.available_dine_in)
              )
          )
        ) order by c.sort
      ), '[]'::jsonb)
      from menu_categories c where c.active = true
    ),
    'zones', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',        z.id,
          'name',      z.name,
          'fee_cents', z.fee_cents,
          'sort',      z.sort
        ) order by z.sort
      ), '[]'::jsonb)
      from delivery_zones z where z.active = true
    )
  );
end;
$$;
