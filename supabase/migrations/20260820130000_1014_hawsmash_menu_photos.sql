-- HAWSMASH 2.0 — 1014: fotos e ingredientes reais do cardápio.
--
-- O 1.0 já vendia com estas fotos e com estas listas de ingredientes; são a
-- imagem que o cliente do HAWSMASH conhece. Entram na BD porque o site lê o
-- cardápio da BD (nunca de constantes no código) — as imagens ficam no repo,
-- em /assets/hawsmash, servidas pelo próprio site.
--
-- Idempotente por desenho: só preenche o que ainda está por preencher. Se o
-- dono trocar a foto ou o texto pelo painel, esta migration não lhe passa por
-- cima.

do $$
declare
  v_item record;
begin
  for v_item in
    select *
    from (values
      ('Classic Smash',
       '/assets/hawsmash/classic-smash.webp',
       'Pão Brioche · Carne Smash Suculenta · Queijo Cheddar · Cebola Caramelizada · Jalapeños · Pickles · Molho Hawsmash'),
      ('Double Smash',
       '/assets/hawsmash/double-smash.webp',
       'Pão Brioche · 2 Carnes Smash Suculentas · Queijo Cheddar · Cebola Caramelizada · Jalapeños · Pickles · Molho Hawsmash'),
      ('Smoked Brisket',
       '/assets/hawsmash/smoked-brisket.webp',
       'Pão Brioche · Carne Smash Suculenta · Smoked Brisket · Cebola Caramelizada · Jalapeños · Pickles · Molho Hawsmash'),
      ('Hawsmash Signature',
       '/assets/hawsmash/hawsmash-signature.webp',
       'Pão Brioche · Carne Hawsmash Suculenta · Carne Wagyu · Smoked Brisket · Queijo Cheddar · Cebola Caramelizada · Jalapeños · Pickles · Molho Hawsmash'),
      ('Pastéis de Nata',
       '/assets/hawsmash/pasteis-de-nata.webp',
       'Massa folhada estaladiça · Creme de ovos · Canela'),
      ('Joe''s Chips',
       '/assets/hawsmash/joes-chips.webp',
       'Batata frita estaladiça · Sal marinho')
    ) as t(name, photo_url, description)
  loop
    update public.menu_items
    set photo_url = v_item.photo_url
    where name = v_item.name
      and (photo_url is null or photo_url = '');

    -- A descrição só é substituída enquanto for o texto genérico do seed.
    update public.menu_items
    set description = v_item.description
    where name = v_item.name
      and (
        description is null
        or description = ''
        or description like '%artesanal HAWSMASH.'
        or description in (
          'Smash burger com brisket fumado.',
          'Burger assinatura HAWSMASH.',
          'Pastéis de nata.',
          'Batata frita Joe''s Chips.'
        )
      );
  end loop;
end $$;
