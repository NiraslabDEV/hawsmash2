-- ============================================================================
-- Fotos recortadas do protótipo aprovado.
--
-- As fotos que a Ana enviou são os CARTAZES de campanha, com o preço e o nome
-- impressos na própria imagem ("Por apenas 1000mt"). Dentro de um cartão de
-- cardápio isso fica a duplicar o texto que a app já desenha por cima — e a
-- ficar ilegível. O design recortou cada cartaz para deixar só o prato; são
-- essas versões que passam a ser a foto de cada item.
--
-- Os cartazes originais continuam em Cardapio-fotos/ na raiz do repo, para
-- redes sociais e impressão.
-- ============================================================================

do $$
declare
  v_base text := '/assets/casa-do-bom-pasteleiro/d/';
  v_map  jsonb := jsonb_build_object(
    'Bacalhau Assado',                      'bacalhau.png',
    'Bacalhau com Natas',                   'bacalhau-c-natas-2-pax.png',
    'Bitoque',                              'bitoque.png',
    'Fillet de Carne',                      'fillet-de-carne.png',
    'Fillet de Peixe Grelhado',             'fillet-de-peixe-grelhado.png',
    'Picanha Grelhada',                     'picanha.png',
    'Camarão Grelhado',                     'camarao.png',
    'Camarão Alinho',                       'camarao-alinho.png',
    'Strogonoff de Carne com Arroz',        'estrogonofe-de-carne-c-arroz.png',
    'Tomahawk 500 gr',                      'tomahawk-500gr.png',
    'Rib Eye Swiss Butter',                 'rib-eye.png',
    'Penne Alfredo',                        'pene-alfredo-de-frango.png',
    'Tagliatelle com Camarão',              'tagliateli-camarao.png',
    'Smash Single Burguer',                 'smash-single-burguer.png',
    'Smash Burguer c/ Ovo',                 'smash-burguer-c-ovo.png',
    'Smash Duplo',                          'smash-duplo.png',
    'Smoked Brisket Smash Burguer',         'smoked-brisket-smash.png',
    'Tosta Pão de Água',                    'torrada-de-pao-de-agua.png',
    'Prego no Pão',                         'prego-completo.png',
    'Tosta Mista',                          'tosta-mista.png',
    'Tosta de Queijo Cheddar com Pastrami', 'tosta-de-queijo-cheddar-c-pastrami.png',
    'Salada Caesar',                        'salada-caesar.png',
    'Salada Grega',                         'salada-grega.png',
    'Salada de Frango ou Atum',             'salada-de-frango-ou-atum.png',
    'Pequeno-Almoço Casa do Bom Pasteleiro','breakfast.png'
  );
  v_name text;
begin
  for v_name in select jsonb_object_keys(v_map)
  loop
    update menu_items
       set photo_url = v_base || (v_map ->> v_name)
     where name = v_name;
  end loop;
end $$;
