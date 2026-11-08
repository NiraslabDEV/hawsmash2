-- 1132 — extras das pizzas e dos burgers, e as observações que a cozinha pediu.
--
-- ⚠ NÃO COPIAR para outra instalação. É a migração de DADOS desta casa; a de
-- estrutura, portável, é a 1131.
--
-- Pedido do dono (7 Nov):
--
--   Extras de pizza:  Macon 100 · Queijo 100 · Brisket 150 · Azeitonas 50 · Atum 150
--   Extras de burger: Macon 50 · Brisket 100 · Jalapeños 50
--   Observações:      sem vegetais · sem molho · sem queijo · sem azeitonas
--
-- Os extras são `menu_addons` de cada produto (o mesmo sítio que o painel do
-- Cardápio edita, que o site, o balcão e o garçom vendem e que o servidor
-- cobra — regra 2). Entram em todos os produtos das categorias Pizzas e
-- Burgers, presentes à data; um produto novo recebe os seus no Cardápio.
-- Cada extra leva a foto do ingrediente (1078); as fotos do brisket, das
-- azeitonas e do atum chegam no mesmo deploy, que tem de ir ANTES desta
-- migration para os botões não abrirem com a imagem partida.
--
-- Só corre onde a marca é esta. Idempotente: um extra com o mesmo nome no
-- mesmo produto não se repete, e o que o dono já tiver mudado (preço, foto,
-- desligado) fica como está. As observações juntam-se às que cada loja já
-- tem, sem as reordenar nem duplicar.

with extras(categoria, nome, preco_cents, foto, ordem) as (
  values
    ('pizza',  'Macon',     10000, '/assets/storefront/extras/bacon.webp',     1),
    ('pizza',  'Queijo',    10000, '/assets/storefront/extras/queijo.webp',    2),
    ('pizza',  'Brisket',   15000, '/assets/storefront/extras/brisket.webp',   3),
    ('pizza',  'Azeitonas',  5000, '/assets/storefront/extras/azeitonas.webp', 4),
    ('pizza',  'Atum',      15000, '/assets/storefront/extras/atum.webp',      5),
    ('burger', 'Macon',      5000, '/assets/storefront/extras/bacon.webp',     1),
    ('burger', 'Brisket',   10000, '/assets/storefront/extras/brisket.webp',   2),
    ('burger', 'Jalapeños',  5000, '/assets/storefront/extras/jalapeno.webp',  3)
)
insert into public.menu_addons (menu_item_id, name, price_cents, sort, active, photo_url)
select i.id, x.nome, x.preco_cents, x.ordem, true, x.foto
  from extras x
  join public.menu_categories c on c.name ilike x.categoria || '%'
  join public.menu_items i on i.category_id = c.id
 where exists (select 1 from public.brand_settings b where b.name ilike 'hawsmash%')
   and not exists (
     select 1 from public.menu_addons a
      where a.menu_item_id = i.id and lower(btrim(a.name)) = lower(x.nome)
   );

update public.store_pos_settings p
   set config = jsonb_set(
         p.config,
         '{quickNotes}',
         coalesce(case when jsonb_typeof(p.config -> 'quickNotes') = 'array' then p.config -> 'quickNotes' end, '[]'::jsonb)
         || coalesce((
              select jsonb_agg(to_jsonb(n.nota) order by n.ordem)
                from unnest(array['SEM VEGETAIS', 'SEM MOLHO', 'SEM QUEIJO', 'SEM AZEITONAS'])
                     with ordinality as n(nota, ordem)
               where not exists (
                 select 1
                   from jsonb_array_elements_text(
                     case when jsonb_typeof(p.config -> 'quickNotes') = 'array'
                          then p.config -> 'quickNotes' else '[]'::jsonb end
                   ) as e(valor)
                  where upper(btrim(e.valor)) = n.nota
               )
            ), '[]'::jsonb)
       ),
       updated_at = now()
 where exists (select 1 from public.brand_settings b where b.name ilike 'hawsmash%');
