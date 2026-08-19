# BLOQUEIOS.md — registo vivo do que ficou pelo caminho

> **Para que serve:** o agente **não pára** para perguntar. Sempre que algo não dá para fechar, escreve aqui,
> deixa o código a funcionar à volta disso, e continua. No fim da corrida, esta lista é atacada **de uma vez só**.
>
> Regras completas em [`AGENTS.md §1`](AGENTS.md). Este ficheiro é **dados**, não teoria: mantém-no actualizado
> na mesma sessão em que descobres o bloqueio, nunca "no fim".

---

## Como escrever aqui

- **ID sequencial** `B-001`, `B-002`… — nunca reutilizar um ID, mesmo depois de resolvido.
- **No código**, o sítio afectado leva um marcador grep-ável: `// BLOQUEIO: B-007` (ou `-- BLOQUEIO: B-007` em SQL).
- **Nos testes** que não podem correr sem a resposta: `it.skip('B-007: ...', ...)` — o ID no nome do teste.
- **No ROADMAP**, o item fica `[~] B-007` em vez de `[ ]`.
- Ao resolver: marcar `✅ RESOLVIDO (data)` **sem apagar a entrada** — o histórico explica porque o código está assim.

### Formato de cada entrada
```
### B-0NN · [FASE] Título curto
- Estado: aberto | ✅ resolvido (data)
- Desbloqueia: cliente | Gabriel | hardware | fornecedor
- Pergunta exacta: (uma frase, respondível com uma frase)
- Como avancei: (stub / placeholder / flag / assunção tomada)
- Onde está: ficheiro:linha · marcador BLOQUEIO: B-0NN
- Se a resposta for outra: (o que muda — minutos? horas? reescrita?)
```

---

## PARAGENS REAIS (o agente parou mesmo)

> Só três coisas justificam parar: **perda de dados**, **dinheiro real gasto/cobrado**, **segredo exposto**.
> Se houver alguma, fica aqui no topo, em maiúsculas, e o agente termina a corrida.

*(nenhuma)*

---

## ABERTOS

### B-001 · [F6] Paysuite: uma conta ou uma por loja
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: o dinheiro do M-Pesa/e-Mola de cada loja cai na **mesma** carteira ou em carteiras separadas?
- Como avancei: `stores.paysuite_api_key`/`paysuite_webhook_secret` existem por loja, com **fallback** para as
  chaves globais em `settings`. Uma conta só funciona hoje; duas contas só exigem preencher as colunas.
- Onde está: `stores` (migration 1001) · `apps/web/lib/payments/config.ts`
- Se a resposta for outra: zero reescrita — é preencher dados.

### B-002 · [F7] Zonas e taxas de entrega da Matola
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: que zonas entrega a Matola e a que preço cada uma?
- Como avancei: seed da Matola com **uma zona `PLACEHOLDER_ZONA` a 150 MT** e a loja com `delivery_enabled`.
  Maputo mantém as zonas reais do 1.0.
- Onde está: `supabase/seed.sql` · marcador `BLOQUEIO: B-002`
- Se a resposta for outra: minutos — inserir linhas em `delivery_zones`.

### B-003 · [F2] Terminal de cartão
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: o terminal de cartão é do banco e independente (o sistema só **regista** que foi cartão), certo?
- Como avancei: `payment_method='credit_card'` é registado como qualquer outro; **nenhuma** integração com terminal.
- Onde está: `create_counter_sale` · POS, ecrã de pagamento
- Se a resposta for outra (querem integração): é **fase nova**, fora do âmbito da proposta — orçamentar.

### B-004 · [F8] Contas de equipa e quem é gerente
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: quantas pessoas por loja e quem fica com perfil de **gerente** em cada uma?
- Como avancei: seed cria `owner` (dono) + 1 `manager` e 1 `cashier` **placeholder** por loja, desactivados
  (`active=false`), para o ecrã de Equipa poder ser testado sem contas reais.
- Onde está: `supabase/seed.sql` · marcador `BLOQUEIO: B-004`
- Se a resposta for outra: minutos — criar contas no ecrã de Equipa.

### B-005 · [F3] Rodapé do talão do cliente
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: que texto/NUIT aparece no rodapé do talão (sem certificação fiscal)?
- Como avancei: `stores.receipt_footer` com `PLACEHOLDER_RODAPE` = "Obrigado! Bom apetite!" (formato do 1.0).
- Onde está: seed + `services/print-bridge/src/escpos.*`
- Se a resposta for outra: minutos — é um campo de texto no painel.

### B-006 · [F3] Hardware físico para validação
- Estado: aberto
- Desbloqueia: hardware (o cliente envia PC touch + impressora + gaveta)
- Pergunta exacta: — (é chegada de equipamento, não é pergunta)
- Como avancei: tudo desenvolvido e testado contra o **simulador** (`pnpm bridge:dev`) com testes de snapshot
  do ESC/POS. O pulso da gaveta está implementado mas **nunca abriu uma gaveta real**.
- Onde está: `services/print-bridge/src/` · testes em `__tests__`
- Se a resposta for outra: os 10 testes de aceitação de `docs/HARDWARE.md §4` são o que valida — 1 a 2 horas
  com o equipamento na mão.

### B-007 · [F0] Protecção de branch em `main`
- Estado: aberto
- Desbloqueia: Gabriel (custo)
- Pergunta exacta: subscrever GitHub Pro/Team para poder exigir CI verde antes de merge em `main`?
- Como avancei: CI corre e fica verde; a **protecção** não está imposta. Disciplina manual entretanto.
- Onde está: `.github/workflows/ci.yml`
- Se a resposta for outra: minutos — activar a regra no GitHub.

### B-008 · [F8] Destino dos backups nocturnos
- Estado: aberto
- Desbloqueia: Gabriel
- Pergunta exacta: para onde vai o `pg_dump` nocturno (Backblaze B2? Google Drive? outro?) e com que credenciais?
- Como avancei: script de dump escrito e testado a escrever **para disco local**; o envio para o destino externo
  fica atrás de env (`BACKUP_TARGET`), inactivo enquanto não houver credencial.
- Onde está: `scripts/backup.*` · marcador `BLOQUEIO: B-008`
- Se a resposta for outra: minutos — preencher env.

### B-009 · [F9] Acesso ao Supabase do HAWSMASH 1.0
- Estado: aberto
- Desbloqueia: Gabriel
- Pergunta exacta: service key (só leitura, se possível) do projecto `tsrgileifpiaiicwjfar` para a importação.
- Como avancei: `scripts/import-hawsmash-1.ts` escrito com **dry-run** e testado contra fixtures do schema antigo.
  Nunca correu contra dados reais.
- Onde está: `scripts/import-hawsmash-1.ts`
- Se a resposta for outra: 1 hora — correr dry-run, conferir totais, correr a sério.

### B-010 · [F9] Data do cutover e DNS
- Estado: aberto
- Desbloqueia: cliente + Gabriel
- Pergunta exacta: em que dia exacto o `hawsmash.com` passa a apontar para o 2.0?
- Como avancei: o 1.0 continua intocado; o 2.0 vive em staging até haver data.
- Onde está: `docs/RUNBOOK.md §6`
- Se a resposta for outra: — (é agenda, não código)

### B-011 · [F9] TVs
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: quantas TVs por loja e o que mostra cada uma — **cardápio** ou **senhas**?
- Como avancei: as duas rotas existem (`/tv/[store]/menu`, `/tv/[store]/senhas`) e funcionam em qualquer browser.
- Onde está: `apps/web/app/(tv)/`
- Se a resposta for outra: minutos — é abrir o URL certo em cada ecrã.

### B-012 · [F7] Domínio de email verificado
- Estado: aberto
- Desbloqueia: Gabriel
- Pergunta exacta: qual o remetente dos emails transacionais e o domínio está verificado no Resend?
- Como avancei: envio usa `RESEND_FROM_EMAIL` do env; sem chave, o sistema **funciona na mesma** e regista o
  email por enviar em `event_log` (nunca bloqueia o pedido).
- Onde está: `apps/web/app/api/emails/`
- Se a resposta for outra: minutos — verificar domínio + preencher env.

### B-013 · [F8] Projecto Sentry e DSN
- Estado: aberto
- Desbloqueia: Gabriel
- Pergunta exacta: criar o projecto Sentry do HAWSMASH 2.0 e passar o DSN (web e print-bridge)?
- Como avancei: `@sentry/nextjs` e `@sentry/node` instalados e ligados ao arranque, mas **inertes sem
  `SENTRY_DSN`**. Sem DSN, o erro fica no log local e nada bloqueia.
- Onde está: `apps/web/instrumentation.ts` · `services/print-bridge/src/observability.ts` · `.env.example`
- Se a resposta for outra: minutos — preencher a env nos dois ambientes.

### B-014 · [F8] Primeiro teste de restauro de backup
- Estado: aberto
- Desbloqueia: Gabriel (ambiente)
- Pergunta exacta: onde corre o teste mensal de restauro — a máquina que corre o cron tem `pg_dump`/`pg_restore`?
- Como avancei: `scripts/backup.mjs` escrito e validado em ensaio (`--dry-run`), política de retenção com
  testes (`scripts/__tests__/backup-plan.test.ts`), e o procedimento de restauro passo a passo no
  `docs/RUNBOOK.md §2`. Nesta máquina não há cliente Postgres nem Docker, por isso o **restauro real nunca
  correu**.
- Onde está: `scripts/backup.mjs` · `docs/RUNBOOK.md` (registo de testes de restauro)
- Se a resposta for outra: 30 minutos — correr os 4 comandos do RUNBOOK e preencher a linha do registo.

---

## RESOLVIDOS

*(mover para aqui, com data, sem apagar o histórico)*

---

## PACOTE FINAL — para atacar de uma vez só

> O agente preenche esta secção **no fim da corrida**, agrupando os abertos por **quem desbloqueia**, com as
> perguntas já redigidas para copiar e enviar. É o que torna esta lista útil em vez de um monte de TODOs.

### Para o cliente (mensagem pronta a enviar)
*(preencher no fim: uma lista numerada de perguntas curtas, em português simples, sem jargão técnico)*

### Para o Gabriel (decisões e acessos)
*(preencher no fim: custo, credenciais, contas)*

### À espera de hardware
*(preencher no fim: o que só se valida com o equipamento na mão, e quanto tempo demora)*

### Ordenado por impacto na abertura
| Prioridade | ID | Sem isto, na abertura… |
|---|---|---|
| | | |
