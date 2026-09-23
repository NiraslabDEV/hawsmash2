-- 1068: as definições do POS que esta instalação já usava, agora como dado.
--
-- ⚠ NÃO COPIAR para outra instalação. É a migração de DADOS desta casa; a de
-- estrutura, portável, é a 1067 (docs/POS-DEFINICOES.md).
--
-- Até à 1067 as notas rápidas e as frases do upsell do balcão estavam no
-- código (`NOTAS_RAPIDAS`, `UPSELL_SCRIPTS`) e falavam do cardápio daqui —
-- WAGYU, natas, jalapeño. O código passou a ter um valor de fábrica neutro;
-- sem esta migração as duas lojas perdiam as frases que a equipa já conhece.
--
-- Só corre onde a marca é esta, e só em lojas sem definições gravadas
-- (`on conflict do nothing`): nunca pisa o que o dono já mudou no painel.

-- O interruptor do upsell do balcão era o mesmo da loja online
-- (`settings.upsell_enabled`). Passa a ser por loja; arranca com o valor que
-- estava ligado, para não mudar nada no dia da actualização.
insert into public.store_pos_settings (store_id, config)
select s.id, jsonb_set($json${
  "quickNotes": [
    "SEM JALAPENO", "SEM CEBOLA", "SEM MOLHO", "SEM QUEIJO", "SEM TOMATE",
    "SEM PICANTE", "BEM PASSADO", "MAL PASSADO", "PARA LEVAR"
  ],
  "upsell": {
    "enabled": true,
    "steps": {
      "companion": {
        "enabled": true,
        "title": "Falta acompanhar?",
        "scripts": [
          "Qual bebida vai levar — Coca, Fanta ou Sprite?",
          "Junto uma batata e uma bebida? Fica completo.",
          "Batata para acompanhar? Sai quentinha agora mesmo.",
          "Uma bebida gelada cai sempre bem com o smash.",
          "Leva batata? É o que mais sai com esse lanche.",
          "Água, refrigerante ou Red Bull?",
          "Quer completar com batata e bebida?"
        ]
      },
      "dessert": {
        "enabled": true,
        "title": "E para fechar?",
        "scripts": [
          "Para fechar, dois pastéis de nata?",
          "Os pastéis de nata acabaram de sair. Leva uns?",
          "Já provou as nossas natas? São feitas aqui.",
          "Uma sobremesa para levar?",
          "Fecha com uns pastéis de nata?"
        ]
      }
    }
  }
}$json$::jsonb,
  '{upsell,enabled}',
  to_jsonb(coalesce((select st.upsell_enabled from public.settings st limit 1), true)))
from public.stores s
where exists (select 1 from public.brand_settings b where b.name ilike 'hawsmash%')
on conflict (store_id) do nothing;
