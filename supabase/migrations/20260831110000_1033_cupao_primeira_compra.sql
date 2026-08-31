-- 1033 — código de campanha PRIMEIRACOMPRA.
--
-- Porquê uma migration e não SQL à mão: o ecrã de pedido recebido passa a
-- mostrar este código ao cliente (espaço C do funil). Um código que aparece
-- no ecrã e é recusado no checkout é pior do que não ter promoção nenhuma —
-- por isso o código tem de existir na base de dados do mesmo lado em que o
-- ecrã foi publicado, e por um caminho versionado (§11.7, nada de SQL manual
-- em produção).
--
-- Como funciona, com o que a tabela já dá:
--   owner_phone = null  → campanha sem dono; ninguém é "o referenciador"
--   max_redemptions     → tecto global da campanha
--   já resgatado por telefone → cada pessoa usa uma vez, e só uma
--
-- Desconto: 10%. É o número que o painel edita depois — a Equipa muda em
-- Marketing sem precisar de deploy nem de nova migration.
--
-- Idempotente: on conflict do nothing. Correr duas vezes não duplica nem
-- reescreve um código que a loja entretanto ajustou à mão no painel.

insert into public.referral_codes (
  code,
  owner_phone,
  owner_name,
  reward_type,
  reward_value,
  referrer_reward_cents,
  max_redemptions,
  active,
  expires_at
)
values (
  'PRIMEIRACOMPRA',
  null,              -- campanha da casa, não é o código de ninguém
  'Campanha',
  'discount_pct',
  10,                -- 10% na primeira encomenda
  0,                 -- sem prémio para quem partilha: não há dono
  1000,              -- tecto da campanha; sobe no painel quando esgotar
  true,
  null               -- sem validade; desliga-se no painel
)
on conflict (code) do nothing;
