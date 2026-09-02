-- HAWSMASH 2.0 — 1041: a marca do HAWSMASH passa a viver na base de dados.
--
-- Migration de DADOS, não de schema. Move para `brand_settings` exactamente o
-- que estava em `config/brand.ts` até aqui, para que o ficheiro possa ficar
-- reduzido a fallback de fábrica sem a montra mudar um pixel (ROADMAP-PRODUTO P1).
--
-- A GUARDA importa: esta migration corre em todas as instalações do motor,
-- incluindo as que ainda não existem. Só escreve quando a instalação já tem
-- lojas — ou seja, quando já é uma operação a andar, que é o caso do HAWSMASH.
-- Numa instalação nova a tabela fica vazia, `get_brand()` devolve null e a
-- aplicação renderiza com a marca de fábrica até o dono preencher a Aparência.
-- Sem esta guarda, todo o restaurante novo nasceria a chamar-se HAWSMASH.

do $$
begin
  if not exists (select 1 from public.stores) then
    return;
  end if;

  if exists (select 1 from public.brand_settings where id = 1) then
    return;
  end if;

  insert into public.brand_settings (
    id, name, tagline, locale, currency,
    logo_path, og_image_path,
    social, contact, theme, storefront
  )
  values (
    1,
    'HAWSMASH',
    'Smash burgers artesanais em Maputo e Matola',
    'pt-MZ',
    'MZN',
    '/assets/storefront/logo.svg',
    '/assets/storefront/logo.svg',
    '{"instagram":"https://instagram.com/hawsmash","facebook":"","whatsapp":"https://wa.me/258860760009"}'::jsonb,
    '{"phone":"+258 86 076 0009","instagram":"@hawsmash","addressLine1":"Maputo e Matola","addressLine2":""}'::jsonb,
    '{"gold":"#e5a93c","goldDeep":"#c48a1e","ember":"#e85a2a","ok":"#3fbf6a","bg0":"#0a0807","bg1":"#111110","bg2":"#1a1816","bg3":"#221f1c","ink":"#f6f1e6","inkDim":"#c8bfb0","inkMute":"#847e72","fontDisplay":"''Bebas Neue'', ''Anton'', Impact, sans-serif","fontBody":"''DM Sans'', ''Inter'', system-ui, sans-serif","fontMono":"''JetBrains Mono'', ui-monospace, monospace","radiusSm":"6px","radiusMd":"10px","radiusLg":"18px"}'::jsonb,
    '{"bg":"#141110","card":"#1d1917","line":"rgba(255,255,255,0.08)","primary":"#e5a93c","primary2":"#c48a1e","grad":"linear-gradient(135deg, #e5a93c 0%, #e85a2a 100%)","star":"#e5a93c","text":"#f6f1e6","muted":"#c8bfb0","muted2":"#847e72","textSoft":"#e8dfd2","muted3":"#a79f92","faint":"#6f6961","surface2":"#241f1c","photoBg":"#221f1c","onDark":"#f6f1e6","onDarkSoft":"#d8d0c3","onDarkMuted":"#9b958a","logoText":"HAWSMASH","fallbackImages":["/assets/storefront/logo.svg"],"hero":{"image":"/assets/storefront/logo.svg","title":"HAWSMASH","subtitle":"Smash burgers artesanais em Maputo e Matola.","cta":"Ver Cardápio"},"landing":{"logoCircle":"/assets/storefront/logo-hawsmash.jpg","storyImage":"/assets/storefront/smoked-brisket.webp","wordmark":"HAWSMASH","wordmarkTag":"Smash Burgers · Pastéis de Nata","hero":{"titleLead":"Encomenda agora.","titleAccent":"Recebes","titleTail":"em {loja}.","subtitle":"Pagamento por M-Pesa ou e-Mola · Entrega ou levantamento no balcão","ctaMenu":"Ver Menu","ctaCart":"Ver Carrinho"},"marquee":["Classic Smash","Double Smash","Smoked Brisket","Hawsmash Signature","Pastéis de Nata","Made in Maputo","Serious Smash"],"menu":{"eyebrow":"O cardápio","title":"Da nossa chapa","lead":"Pão tostado, carne prensada na chapa e queijo a derreter na hora. Escolhe, monta o pedido e paga por M-Pesa ou e-Mola."},"story":{"eyebrow":"Quem somos","titleLead":"Smash","titleAccent":"Sério","titleTail":"Sabor que marca Maputo e Matola.","paragraphs":["Nascemos em Maputo com uma ideia simples: um smash burger feito a sério — pão tostado, carne 100% bovina prensada na chapa, queijo a derreter na hora. Sem atalhos. Sem corte de tempo. Sem corte de qualidade.","Levámos esse sabor às maiores feiras e eventos da cidade. Agora somos duas casas — Maputo e Matola — com a mesma chapa e o mesmo molho."],"stats":[{"n":"2","l":"Lojas · Maputo e Matola"},{"n":"100%","l":"Carne fresca"},{"n":"10+","l":"Eventos · 2026"},{"n":"2K26","l":"Ano de fundação"}],"tagKey":"Hawsmash · Made in Maputo","tagValue":"Serious Smash"},"footer":{"ctaLead":"Pronto para","ctaAccent":"Smash?","blurb":"Smash burgers a sério em Maputo e Matola. Encomenda no site, levanta no balcão ou recebe em casa.","rights":"© 2026 HAWSMASH · Todos os direitos reservados","madeIn":"Made in ","madeInAccent":"Maputo"}},"funnel":{"promos":[{"kicker":"Da casa","title":"Passa a quem ainda não provou.","body":"Menos 10% na primeira encomenda. Cada telefone usa uma vez.","cta":"","href":"","code":"PRIMEIRACOMPRA","note":"Válido no site e ao balcão, nas duas lojas."},{"kicker":"Loja nova","title":"Matola já abriu.","body":"Mesma chapa, mesmo molho. Entrega em Matola a partir das 12h.","cta":"Ver a loja Matola","href":"/l/matola","code":"","note":""}],"waiting":""},"poweredBy":{"enabled":true,"name":"NIRASLAB","kicker":"Software para restaurantes","title":"Este ecrã é o nosso trabalho.","body":"Construímos o sistema que acabou de receber o seu pedido. Está a correr nas duas lojas da HAWSMASH neste momento.","proof":["Duas lojas, um painel","M-Pesa confirmado sozinho","Do site à cozinha em segundos"],"cta":"Falar no WhatsApp","whatsapp":"https://wa.me/258853860621","email":"niraslab.dev@gmail.com","accent":"#7ea8ff","bg":"#101319","bg2":"#090b0f","ink":"#e8ecf2","inkDim":"#7a8494","inkMute":"#5c6675"}}'::jsonb
  );
end;
$$;
