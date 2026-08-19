-- HAWSMASH 2.0 — F8: o evento de empresa (equipa) vive sem loja.
--
-- O trigger private.enforce_event_context continua a exigir loja a quem não é
-- dono; a coluna é que deixa de ser obrigatória para o caso da empresa.

alter table public.event_log alter column store_id drop not null;
