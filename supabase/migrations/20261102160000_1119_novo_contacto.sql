-- HAWSMASH 2.0 — 1119: novo contacto de apoio ao cliente (+258 87 030 1006).
--
-- Migration de DADOS, não de schema. O HAWSMASH passou a ter um só número para
-- informações e apoio, nas duas lojas (flyer "Novo contacto", 02/11). Até aqui:
--   - a marca mostrava o número antigo (+258 86 076 0009) no rodapé, no WhatsApp
--     e no ecrã do pagamento;
--   - `stores.phone` estava vazio, por isso talões, emails do pedido, ecrã de
--     estado e alertas ("Falar com a loja no WhatsApp") não tinham contacto.
--
-- A GUARDA importa: esta migration corre em todas as instalações do motor. Só
-- escreve onde a marca ainda tem o número antigo do HAWSMASH — noutro
-- restaurante, ou se o dono já mudou o contacto na Aparência, não toca em nada.
-- Telefone de loja já preenchido também fica como está.

do $$
begin
  if not exists (
    select 1 from public.brand_settings
     where id = 1
       and regexp_replace(coalesce(contact ->> 'phone', ''), '\D', '', 'g') = '258860760009'
  ) then
    return;
  end if;

  update public.brand_settings
     set contact = contact || '{"phone":"+258 87 030 1006"}'::jsonb,
         social  = social  || '{"whatsapp":"https://wa.me/258870301006"}'::jsonb
   where id = 1;

  update public.stores
     set phone = '+258 87 030 1006'
   where slug in ('maputo', 'matola')
     and coalesce(btrim(phone), '') = '';
end;
$$;
