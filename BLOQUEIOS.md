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

## Estado actual do registo — revisão documental de 26/09/2026

**39 entradas abertas e 2 resolvidas no texto** (35 da revisão documental + B-115–B-118 das correcções do mesmo dia). Esta contagem não é validação de uma instalação. As dependências e parcelas já documentadas como resolvidas foram esclarecidas em B-006/B-008/B-012/B-022/B-101/B-110; nenhum bloqueio foi fechado sem evidência suficiente.

As [violações de código identificadas na auditoria](docs/AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec) foram corrigidas no mesmo dia no branch `fix/violacoes-spec`, salvo V-03, V-10 e V-11 (decisões B-116–B-118); o estado item a item está na §5.1 da auditoria. **As migrations 1097–1099 não estão aplicadas em nenhuma base** — B-115.

**Acrescentado depois desta revisão:** B-119 (02/10, trabalho da 1113). A contagem acima é a de 26/09 e não se reescreve; as migrations pendentes de aplicação no LIVE — 1108 a 1113 — estão nos itens `[ ]` do [ROADMAP](ROADMAP.md), não como bloqueios, porque dependem só de uma janela fora do horário da loja.

## ABERTOS

### PACOTE FINAL — revisão documental de 26/09/2026

**35 entradas abertas; 2 resolvidas no arquivo.** Contagem do texto, sem novas consultas a instalações. Os pacotes datados no fim conservam as contagens de cada corrida; não são o estado actual. A revisão não executou SQL, deploy, pagamentos ou hardware. Os testes unitários estão documentados na [validação](docs/validation/revisao-documental-2026-09-26.md).

| Responsável principal para organizar a próxima passagem | Quantidade | IDs |
|---|---:|---|
| Cliente, contabilista ou fornecedor, com Gabriel quando necessário | 15 | B-001–005, B-010–011, B-015, B-019–021, B-100, B-107, B-109, B-112 |
| Gabriel — acessos, configuração e validação | 15 | B-007–008, B-012–014, B-022, B-103–106, B-108, B-110–111, B-113–114 |
| Hardware | 2 | B-006, B-018 |
| Engenharia | 3 | B-017, B-101–102 |

Cada entrada aparece uma vez nesta contagem. As dependências partilhadas mantêm-se descritas no corpo. B-017 conserva a resposta posterior do cliente sobre consumir os componentes do combo; essa resposta não prova implementação.

**Para o cliente — perguntas restantes, prontas a copiar**

1. Confirmar a conta de recebimento por loja e, com os fornecedores, os acessos de M-Pesa/e-Mola e um extracto de exemplo sem dados de clientes (B-001, B-100, B-107, B-109).
2. Confirmar as zonas/taxas da Matola, o terminal de cartão e quem trabalha em cada loja com perfil de gerente (B-002–004).
3. Validar moradas, contactos públicos e rodapé/NUIT dos talões; com o contabilista, confirmar o circuito fiscal e formato de importação (B-005, B-015, B-019, B-112).
4. Confirmar custos e produtos ainda em falta, TVs disponíveis e data de troca do sistema/DNS (B-020, B-011, B-010).
5. Para a Fase 2, definir quem responde ao chat, em que horário e quais as dúvidas iniciais (B-021).

**Para o Gabriel**

Confirmar protecção de branch, ambientes e DNS; configurar e ensaiar SMTP, Sentry, agendadores, backup externo e restauro. A selecção de destino de backup exige também implementar o transporte. Validar separadamente paginação, reconciliação, e-Mola, login humano no POS, análise, upload de TV e resumo mensal/Google. Publicação MCP/ChatGPT é opcional e tem a sua própria aceitação. Não voltar a pedir segredos já entregues: verificar o estado no canal de configuração próprio quando essa tarefa for autorizada.

**Hardware e duração prevista**

- B-006: 1–2 h por loja para formatos/vias, gaveta, falhas de rede/papel, recuperação e arranque Windows; ensaio geral cerca de 90 min por loja. A abertura da gaveta já relatada não valida este conjunto.
- B-018: cerca de 5 min por loja para identificar porta/protocolo, mais o ensaio de texto e reconexão do visor.
- B-011: duração depende das TVs/boxes; confirmar legibilidade, vídeo/cache, som e reconexão na instalação.

| Prioridade pelo impacto na abertura | Sem isto, o que falta assegurar |
|---|---|
| B-115 — aplicar 1097–1099 e o código de `fix/violacoes-spec` | Isolamento, privacidade, autorização financeira, retry de movimentos e confirmação online independente da fila de impressão. Corrigido e provado numa BD local; sem efeito até aplicar |
| B-006, B-004, B-110 | Venda por operador, papel e operação contínua nas duas lojas |
| B-017, B-020, B-101–102 | Controlo de componentes/custos e prova de integridade de stock, conta e isolamento na BD |
| B-002–003, B-001, B-100, B-106–109 | Entrega na zona correcta e recebimento/reconciliação; manual é contingência, não validação dos automáticos |
| B-007–008, B-012–014, B-022, B-010 | Publicação controlada, notificações, recuperação de dados e cutover |
| B-005, B-015, B-019, B-112 | Dados do talão e circuito fiscal/contabilístico correcto |
| B-011, B-018, B-105, B-111, B-113–114 | Visor/TVs, validação de consultas, análise e relatórios automáticos |
| B-021, B-103–104 | Chat futuro e publicação dos canais de agentes; não impedem o POS normal |

As 16 violações da spec permanecem no relatório, separadas dos IDs históricos de bloqueio. Documentá-las não as corrige nem autoriza produção.

### B-001 · [F6] Paysuite: uma conta ou uma por loja
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: o dinheiro do M-Pesa/e-Mola de cada loja cai na **mesma** carteira ou em carteiras separadas?
- Como avancei: `stores.paysuite_api_key`/`paysuite_webhook_secret` existem por loja, com **fallback** para as
  chaves globais em `settings`. Uma conta só funciona hoje; duas contas só exigem preencher as colunas.
- Onde está: `stores` (migration 1001) · `apps/web/lib/payments/config.ts`
- Nota da F10: as chaves do Paysuite **não** são editáveis nem legíveis no painel (são segredo; o grant por
  coluna tira-as do alcance do browser). Entram por migration ou pelo Supabase, nunca pelo ecrã.
- Se a resposta for outra: zero reescrita — é preencher dados.

---

### B-002 · [F7] Zonas e taxas de entrega da Matola
- Verificação LIVE (28/09/2026): `scripts/check-placeholders.mjs` encontrou
  `PLACEHOLDER_ZONA` na base `hawsmash2`; `RELEASE_GUARD=1` impede o próximo build
  de produção enquanto a zona não for substituída por dados aprovados.
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: que zonas entrega a Matola e a que preço cada uma?
- Como avancei: seed da Matola com **uma zona `PLACEHOLDER_ZONA` a 150 MT** e a loja com `delivery_enabled`
  (a taxa é a mesma que o 1.0 cobra em Maputo). Maputo mantém a zona real do 1.0.
  `scripts/check-placeholders.mjs` **falha o go-live** enquanto esta zona existir com este nome.
- Onde está: `supabase/seed.sql` · marcador `BLOQUEIO: B-002` · guarda em `scripts/check-placeholders.mjs`
- Se a resposta for outra: **minutos, pelo painel** — aba Lojas → Matola → zonas de entrega (F10). Já não
  precisa de ninguém a mexer na base de dados.

---

### B-003 · [F2] Terminal de cartão
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: o terminal de cartão é do banco e independente (o sistema só **regista** que foi cartão), certo?
- Como avancei: `payment_method='credit_card'` é registado como qualquer outro; **nenhuma** integração com terminal.
- Onde está: `create_counter_sale` · POS, ecrã de pagamento
- Se a resposta for outra (querem integração): é **fase nova**, fora do âmbito da proposta — orçamentar.

---

### B-004 · [F8] Contas de equipa e quem é gerente
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: quantas pessoas por loja e quem fica com perfil de **gerente** em cada uma?
- Como avancei: a aba **Equipa** já cria contas, atribui perfil/lojas e define PIN (`/equipa`), e a remoção
  de acesso é imediata. Falta só **quem** são as pessoas — nenhuma conta real foi criada.
- Onde está: `apps/web/app/(admin)/equipa/page.tsx` · RPC `set_staff_access` / `deactivate_staff`
- Se a resposta for outra: minutos — criar contas no ecrã de Equipa.

---

### B-005 · [F3] Rodapé do talão do cliente
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: que texto/NUIT aparece no rodapé do talão (sem certificação fiscal)?
- Como avancei: `stores.receipt_footer` com `PLACEHOLDER_RODAPE` = "Obrigado! Bom apetite!" (formato do 1.0).
- Onde está: seed + `services/print-bridge/src/escpos.*` · edição na aba **Lojas** (F10)
- Se a resposta for outra: minutos — é um campo de texto na aba Lojas, por loja.
- **Nota 2026-08-28 — modelo confirmado com o cliente:** o HAWSMASH 2.0 corre **toda** a operação
  (venda, cozinha, caixa, estoque, delivery); **facturação fiscal certificada e contabilidade ficam
  à parte**, pagas pelo Ridwan directamente a um software/contabilista habilitado pela AT. Isto já
  estava fechado em `CLAUDE.md §0` ("Facturação fiscal certificada (AT)" fora de âmbito) — a conversa
  de hoje só confirmou que é assim mesmo, não uma mudança de plano.
  - Pesquisa (2026-08-28): desde mai/2025 Moçambique exige comunicação mensal de facturas à AT via
    software **certificado**; em 2026 factura manual só é permitida até 50 mil € de volume anual —
    acima disso é obrigatório software certificado (Aviso 40/AT/DGI/2025). Isto reforça que faz
    sentido **não** tentar certificar o HAWSMASH — é caminho caro e fora do contrato de 50.000 MT.
  - **Implementado 2026-08-28:** caminho de exportação construído — aba **Análise** → cartão
    "Exportar para o contabilista": CSV com uma linha por **pagamento confirmado/devolvido**
    (data, loja, nº pedido, canal, cliente, subtotal, taxa de entrega, total do pedido, forma de
    pagamento, valor do pagamento, referência), filtrável por loja e período. É ao nível do
    pagamento e não do pedido porque uma venda pode ter dinheiro + M-Pesa no mesmo talão (§7.1) —
    é o pagamento que bate certo com o extracto do banco/carteira móvel.
    - RPC `public.export_sales_for_accounting(p_store_id, p_from, p_to)` — `owner`/`manager`,
      `auth_can_store` por loja; `p_store_id` null (consolidado) só para `owner`.
    - Rota `apps/web/app/api/reports/export-sales/route.ts` gera o CSV (UTF-8 com BOM, valores
      em MT com 2 casas).
    - Migration `supabase/migrations/20260828100000_1028_export_contabilidade.sql` — **por aplicar
      em staging** (`supabase db push`), depois testar o download com uma conta `manager` e uma
      `owner` antes de ir a `main`.
  - Ponto a alinhar com o contabilista do Ridwan (não é decisão técnica): se o software fiscal
    escolhido pedir outro layout de colunas, é ajuste no CSV, não reescrita — hoje o compromisso é
    esta **exportação CSV a qualquer
    momento** (`CLAUDE.md §11.6`); se o software fiscal escolhido pedir outro formato, é o
    contabilista que diz qual.
  - Se o contabilista vier a exigir formato/campo específico no rodapé do talão (NUIT, texto legal),
    entra aqui como o mesmo B-005 — é o mesmo campo de texto, não obriga a reescrita.

---

### B-006 · [F3] Hardware físico para validação

**Revisão documental (26/09):** o registo de 02/09 abaixo já confirma a gaveta a abrir pela impressora. A frase inicial sobre nunca ter aberto é histórica; o bloqueio fica aberto para o conjunto de ensaios por loja, não para repetir essa conclusão.

- Estado: aberto
- Desbloqueia: hardware (o cliente envia PC touch + impressora + gaveta)
- Pergunta exacta: — (é chegada de equipamento, não é pergunta)
- Como avancei: tudo desenvolvido e testado contra o **simulador** (`pnpm bridge:dev`) com testes de snapshot
  do ESC/POS. O pulso da gaveta está implementado mas **nunca abriu uma gaveta real**.
- **2026-08-22 — primeira sessão com equipamento real (AnyPOS100 da Matola):**
  - Impressora integrada `POS80` (fila Windows, porta `VPORT-USB:`) **imprime** — página de teste OK.
  - Gaveta ligada à porta **`CD`** do terminal (estava indevidamente no `COM 3`; corrigido).
  - Pulso `1B 70 00 19 FA` (pinos 2 e 5) tentado por **todos** os caminhos, sem resultado: as seis portas
    série (`COM1`–`COM6`), RAW para a fila partilhada da `POS80`, e a opção do próprio driver
    `Cash-Box: Open After print` em Device Settings.
  - **Conclusão provisória:** o caminho de software está provado (a impressora responde); a suspeita passa
    para hardware — cabo (6P6C vs 4 fios), tensão da gaveta (a porta do terminal é 12 V) ou a fechadura.
  - Nota para o futuro: `Print Mode: Graphic` + `Enable advanced printing features` fazem o Windows
    rasterizar os trabalhos, o que destrói ESC/POS em bruto enviado pelo driver.
  - Plano B inalterado: a gaveta liga à `XP-T80Q` do balcão, como `docs/operacao/hardware.md §2` sempre previu.
  - **Causa encontrada (2026-08-22):** o cabo que veio com a gaveta é **6P4C (4 pinos)** — cabo de telefone.
    Os dois contactos em falta, os de fora, são os que alimentam o solenóide. Encaixa na `CD`, parece bom,
    e nunca abre. **Todos** os pulsos que enviámos chegaram à porta e não tinham fio por onde seguir.
    Resolve-se com um cabo de gaveta **6P6C (6 pinos)**. Nada de código a mudar.
- **2026-09-02 — A GAVETA ABRIU.** Com o RJ11 na porta `CD` **da própria impressora** (não na do
  terminal), o pulso `1B 70 00 19 FA` entregue por `copy /b` para a fila `POS80` abriu a gaveta à
  primeira. Confirma as duas conclusões acima: quem alimenta o solenóide é a **impressora** (24 V), não
  o terminal (12 V) — e era por isso que nenhum caminho pelas `COM` podia funcionar.
  - **Regra que fica:** a gaveta liga **sempre** à impressora configurada como `COUNTER`. É a essa que
    o bridge manda o pulso (`index.ts`, `sendDrawerPulse(config.printers.counter, …)`).
  - **A impressora acoplada por USB já era suportada** — `windows://POS80` existe desde a
    `printer-target.ts` e é o que os `.env` das lojas devem usar. Não é preciso mudar código para USB;
    o `PRINTER_IP_*`/TCP do `docs/operacao/hardware.md` é só o caminho alternativo, para impressora de rede.
- Onde está: `services/print-bridge/src/` · testes em `__tests__`
- Se a resposta for outra: os 10 testes de aceitação de `docs/operacao/hardware.md §4` são o que valida — 1 a 2 horas
  com o equipamento na mão.

---

### B-007 · [F0] Protecção de branch em `main`
- Estado: aberto
- Desbloqueia: Gabriel (custo)
- Pergunta exacta: subscrever GitHub Pro/Team para poder exigir CI verde antes de merge em `main`?
- Como avancei: CI corre e fica verde; a **protecção** não está imposta. Disciplina manual entretanto.
- Onde está: `.github/workflows/ci.yml`
- Se a resposta for outra: minutos — activar a regra no GitHub.

---

### B-008 · [F8] Destino dos backups nocturnos

**Revisão documental (26/09):** BACKUP_TARGET não activa um transportador pronto; `scripts/backup.mjs` informa que o envio externo não está implementado. Configurar uma credencial só não fecha esta parte.

- Estado: aberto
- Desbloqueia: Gabriel
- Pergunta exacta: para onde vai o `pg_dump` nocturno (Backblaze B2? Google Drive? outro?) e com que credenciais?
- Como avancei: script de dump escrito e testado a escrever **para disco local**; o envio para o destino externo
  fica atrás de env (`BACKUP_TARGET`), inactivo enquanto não houver credencial.
- Onde está: `scripts/backup.*` · marcador `BLOQUEIO: B-008`
- Se a resposta for outra: minutos — preencher env.

---

### B-010 · [F9] Data do cutover e DNS

**Cutover em 29/09/2026 (~23:10, loja fechada), por decisão do Gabriel ([ADR 0008](docs/decisions/0008-staging-passa-a-live.md)):**
`hawsmash.com` e `www` saíram do projecto Railway do 1.0 e foram para o `hawsmash2 / production`,
que já serve a base da loja (`pqjoan…`). Alvos novos: `@` → `lhe2xb8u.up.railway.app`,
`www` → `nf5vpac8.up.railway.app`, mais os TXT `_railway-verify` e `_railway-verify.www` com os
valores novos. O 1.0 continua no endereço Railway dele. Importação de pedidos e clientes do 1.0
preparada (`--sem-cardapio`, pendentes como cancelados, trava de emails) e por correr.

**30/09/2026:** DNS mudado na Hostinger pelo Gabriel (raiz como ALIAS → `lhe2xb8u…`, `www`, os dois
TXT; MX, SPF, DMARC e DKIM intactos). Certificados Let's Encrypt emitidos para `hawsmash.com` e `www`
(válidos até 29/12/2026); os dois domínios aparecem verificados no Railway. Confirmado às 07:05:
`hawsmash.com` serve o 2.0 com a base da loja (bundle com `pqjoan…`, 26 itens em Maputo, Matola 404).
O 1.0 não tinha service worker — nenhum browser fica preso numa cópia antiga.

**Importação do 1.0 feita a 30/09, 07:44–07:57** (`--apply --i-know-this-is-live --sem-cardapio`, para
Maputo, depois de dry-run com validação de todos os registos). Reconciliação exacta com o 1.0: 1024
pedidos (955 entregues = 950 entregues + 5 pagos; 69 cancelados = 67 + 2 pendentes), 2128 linhas de
itens, 1.277.820,00 MT faturados, 04/06 a 29/09 17:07. 511 clientes, 30 fundidos com os que já
existiam (561 no total). Nenhum email em fila, nenhum pedido do 1.0 activo na fila do POS, cardápio
intacto. Repetir a importação é seguro (o número do pedido é único) se o 1.0 ainda receber algum.
Falta: passar os terminais para `hawsmash.com/pos`.

- Estado: aberto — domínio no 2.0 e 1.0 importado; terminais pendentes
- Desbloqueia: cliente + Gabriel
- Pergunta exacta: em que dia exacto o `hawsmash.com` passa a apontar para o 2.0?
- Como avancei: o 1.0 continua intocado; o 2.0 vive em staging até haver data.
- Onde está: `docs/operacao/runbook.md §6`
- Se a resposta for outra: — (é agenda, não código)

---

### B-011 · [F9] TVs
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: quantas TVs por loja e o que mostra cada uma — **cardápio** ou **senhas**?
- Como avancei: as duas rotas existem e funcionam em qualquer browser sem sessão —
  `/tv/[store]/menu` (cardápio com esgotados) e `/tv/[store]/senhas` (número do dia). Ambas recarregam
  sozinhas e mantêm o último estado se a rede oscilar.
- Onde está: `apps/web/app/(tv)/` · RPC `get_store_board` e `get_store_queue`
- Se a resposta for outra: minutos — é abrir o URL certo em cada ecrã.
- **Actualização 24 Set (1090):** respondido em parte — **2 TVs por loja, com vídeos e senhas, e espaço para
  mais**. Já não é preciso decidir no código: cada TV tem o seu endereço (`/tv/maputo/tv1`, `/tv/maputo/tv2`…)
  e o que mostra escolhe-se na aba **TVs** do painel. Falta: os vídeos em si (o dono carrega-os na aba) e
  apontar cada box ao seu endereço. `docs/modulos/tvs-kds.md`.

---

### B-012 · [F7] Domínio de email verificado

**Revisão documental (26/09):** o fornecedor actual é SMTP (ADR 0004). Para fechar: confirmar SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS, EMAIL_FROM e recepção efectiva. Resend era a solução anterior e não é requisito desta instalação; ver `apps/web/lib/email/transport.ts`.

- Estado: aberto
- Desbloqueia: Gabriel
- Pergunta exacta: qual o remetente dos emails transacionais e o domínio está verificado no Resend?
- Como avancei: envio usa `RESEND_FROM_EMAIL` do env; sem chave, o sistema **funciona na mesma** e regista o
  email por enviar em `event_log` (nunca bloqueia o pedido).
- Onde está: `apps/web/app/api/emails/`
- Se a resposta for outra: minutos — verificar domínio + preencher env.

---

### B-013 · [F8] Projecto Sentry e DSN
- Estado: aberto
- Desbloqueia: Gabriel
- Pergunta exacta: criar o projecto Sentry do HAWSMASH 2.0 e passar o DSN (web e print-bridge)?
- Como avancei: `@sentry/nextjs` e `@sentry/node` instalados e ligados ao arranque, mas **inertes sem
  `SENTRY_DSN`**. Sem DSN, o erro fica no log local e nada bloqueia.
- Onde está: `apps/web/instrumentation.ts` · `services/print-bridge/src/observability.ts` · `.env.example`
- Se a resposta for outra: minutos — preencher a env nos dois ambientes.

---

### B-014 · [F8] Primeiro teste de restauro de backup
- Estado: aberto
- Desbloqueia: Gabriel (ambiente)
- Pergunta exacta: onde corre o teste mensal de restauro — a máquina que corre o cron tem `pg_dump`/`pg_restore`?
- Como avancei: `scripts/backup.mjs` escrito e validado em ensaio (`--dry-run`), política de retenção com
  testes (`scripts/__tests__/backup-plan.test.ts`), e o procedimento de restauro passo a passo no
  `docs/operacao/runbook.md §2`. Nesta máquina não há cliente Postgres nem Docker, por isso o **restauro real nunca
  correu**.
- Onde está: `scripts/backup.mjs` · `docs/operacao/runbook.md` (registo de testes de restauro)
- Se a resposta for outra: 30 minutos — correr os 4 comandos do RUNBOOK e preencher a linha do registo.

---

### B-015 · [F7] Morada e contacto de cada loja
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: qual a morada exacta (e telefone) de cada loja — Maputo e Matola — para aparecer no site?
- Como avancei: `stores.address`, `stores.phone` e `stores.maps_url` estão vazios; o ecrã de escolha mostra
  "Morada por confirmar" e o rodapé simplesmente omite a linha em falta — nada quebra, mas o cliente não
  sabe onde levantar. A pele nova do site (portada do 1.0) tornou isto visível em dois sítios.
- Onde está: `apps/web/app/(public)/page.tsx` · `_hawsmash/sections.tsx` (rodapé) · dados em `stores`
- Se a resposta for outra: minutos, pelo painel — aba **Lojas** → morada, telefone e link do mapa.

---

### B-017 · [F6] Stock dos combos vendidos como produto único
- Estado: **aberto — decisão consciente, não é bug** vou querer que quando saia um combo, desconte da batata e da cocacola. pode fazer oque precisar mas robusto para nunca quebrar nada.
- Desbloqueia: ninguém por agora (não morde enquanto o stock estiver desligado)
- O que se passa: os combos (`lanche + batata e bebida`, base + 190 MT) entram no cardápio como
  **produtos próprios**, por decisão do dono — o que evita variantes, modificadores e uma migration
  no caminho do dinheiro. O senão: vender um combo desconta stock do **combo**, não da Joe's Chips
  nem da bebida que saíram de facto.
- Porque não morde hoje: confirmado em 2026-08-23 que **0 de 26 linhas** de `store_items` têm
  `track_stock`. Ninguém controla stock ainda.
- Quando morde: no dia em que ligarem controlo de stock na batata ou nas bebidas. As contagens
  começam a fugir e o desvio não tem explicação óbvia — é o género de coisa que se descobre num
  inventário, três semanas depois, sem se perceber porquê.
- Saídas quando chegar a altura: (a) receita por produto — o combo declara o que consome; ou
  (b) `menu_modifier_groups`, que já existem na base de dados e estão por preencher.
- Onde está: `menu_items` (combos) · `store_items.track_stock` · `CLAUDE.md §10`
- **2026-08-27 — saída (a) implementada.** As migrations 1024–1027 criaram a camada de
  ingredientes (`ingredients`, `store_ingredients`, `recipe_items`) e a venda passa a descontar
  matéria-prima pela ficha técnica, por (produto, variante). Os burgers do cardápio já têm ficha.
  **O que continua aberto é só o preenchimento:** os combos foram criados no painel (não estão em
  nenhuma migration) e ainda não declaram o que consomem. Enquanto não declararem, um combo vendido
  não desconta carne nenhuma — que é melhor do que descontar a errada, mas ainda não é o certo.
  Fecha-se no painel, sem código, assim que houver a lista do que cada combo leva.

---

### B-018 · [F3] Visor do cliente: porta, velocidade e protocolo
- Estado: aberto
- Desbloqueia: hardware (5 minutos em cada loja, com o PC ligado)
- Pergunta exacta: em que **porta COM** está o mostrador de cada PC touch, a que **velocidade**, e
  fala **CD5220** ou **Epson DM-D (ESC/POS)**? ecom2 em maputo... matola nao sabemos ainda.. vou ligar o claude naquela maquina e ele vai mexer nela.
- Como avancei: o visor está inteiro e testado — o POS manda a trama a cada passo da venda e o bridge
  escreve nas duas linhas, com o nome da casa a andar quando não há venda. Os dois protocolos estão
  implementados e escolhem-se por `CUSTOMER_DISPLAY_PROTOCOL`. Com `CUSTOMER_DISPLAY_PORT` vazio o
  visor fica **desligado** e o bridge corre exactamente como antes; com `sim` escreve na consola, que
  é como foi desenvolvido e testado sem hardware.
- Onde está: `services/print-bridge/src/customer-display.ts` · `.env.example` · `docs/operacao/hardware.md §1.2`
- Se a resposta for outra: **zero reescrita** — são três linhas de `.env`. O único caso que obriga a
  código é o mostrador falar um terceiro protocolo (nem CD5220 nem DM-D); aí é meia hora, com o
  manual do modelo à frente.
- Nota: a escrita na porta série é feita com `mode.com` + `\\.\COMx` e **não** com o módulo
  `serialport`, de propósito — um binding nativo partiria o empacotamento `.exe` (SEA) do bridge que
  já corre nas lojas.

---

### B-019 · [F0] Enquadramento fiscal: facturação certificada pela AT
- Estado: aberto
- Desbloqueia: cliente + contabilista de Maputo
- Pergunta exacta: o HAWSMASH precisa de emitir **factura fiscal certificada** (regime da AT, com numeração
  sequencial inalterável, autenticação e comunicação periódica à AT) para as vendas de balcão/delivery, ou o
  talão actual (documento de venda, sem valor fiscal) chega para o negócio?
- Porque importa: pesquisa confirma que Moçambique tem um regime real de **software de facturação certificado**
  pela Autoridade Tributária (numeração sequencial inalterável, autenticação de utilizador, integridade dos
  dados, comunicação de facturas à AT) e uma **lista oficial de programas certificados**. O HAWSMASH 2.0 **não
  está nessa lista** — o `CLAUDE.md §0` já assume isto como fora de âmbito da proposta fechada.
- Como avancei: nada mudou no código — o sistema continua a emitir **talão de venda**, não factura fiscal.
  Fica registado aqui para não passar despercebido, porque muda a decisão comercial, não é um detalhe técnico.
- Onde está: `CLAUDE.md §0` ("Fora de âmbito"), `CLAUDE.md §16` item 8 (rodapé do talão, "sem certificação fiscal")
- Se a resposta for outra (o cliente/contabilista exigir factura certificada): **não é código, é integração**
  — ou se liga a um dos softwares já certificados pela AT para emitir a factura fiscal a par do talão, ou
  orçamenta-se a certificação do próprio HAWSMASH junto da AT. Fora do âmbito e do preço fechado em §0.
- Fontes consultadas: [EY Moçambique](https://www.ey.com/pt_mz/technical/tax-alerts/procedimento-de-comunicacao-das-facturas-emitidas-a-autoridade-tributaria-de-mocambique) ·
  [Zumbo Cloud ERP](https://zumbocloud.com/facturacao-certificada-at) ·
  [Cegid Vendus](https://www.vendus.co.mz/blog/comunicar-faturas-autoridade-tributaria-mocambique/) ·
  [Lista provisória AT](https://www.at.gov.mz/por/Media/Files/LISTA-PROVISORIA-DE-SOFTWARES-DE-FACTURACAO-AT-DGI-PMF)

---

### B-020 · [F6] Custos e destino do bacon, e o preço da batata

- Estado: **aberto — descoberto em 2026-08-27**
- Desbloqueia: cliente (Ridwan) nao vamos ter bacon pq e muslim esse role/.. 
- Pergunta exacta: quanto custa cada fatia de queijo, cada fatia de bacon e cada porção de brisket —
  e em que produto sai o bacon?
- O que se passa: o Ridwan fechou os custos das duas carnes (**RAW 75 MT**, **WAGYU 100 MT**) e pediu
  para controlar também **queijo em fatias**, **bacon em fatias** e **brisket à porção**. Os três
  ficaram criados com **custo 0**, porque um custo inventado é pior do que nenhum: a margem passaria
  a mentir com ar de certa, e é sobre ela que se decide preço.
- O bacon não aparece em nenhum burger do cardápio actual (nem no 2.0, nem nas descrições do 1.0 que
  estão no repositório). Existe no site do 1.0 em produção — falta saber se é **adicional pago** ou
  se faz parte de algum produto. Por isso ficou **criado e contável, mas sem ficha técnica**.
- Também por confirmar: a **Joe's Chips** passa a **tamanho único a 75 MT** (hoje está a 150 MT no
  cardápio). É mudança de preço, muda-se no painel — não é código.
- Como avancei: os três ingredientes existem, contam-se e aparecem no painel; entram no CMV a 0 até
  alguém preencher. Quem abrir o ecrã vê "custo por preencher" em vez de um número inventado.
- Onde está: `supabase/migrations/20260827130000_1027_ficha_tecnica_hawsmash.sql` · marcador
  `BLOQUEIO: B-020`
- Se a resposta for outra: minutos — é escrever três números e uma linha de ficha no painel.

---

### B-021 · [G9] Chat no site: quem responde, quando, e quais são as dúvidas

- Estado: **aberto — ideia do Gabriel em 2026-08-28, agendada para a Fase 2**
- Desbloqueia: cliente (Ridwan)
- Pergunta exacta: **quem responde às conversas no balcão, em que horário, e quais são as 6–8 dúvidas
  que devem aparecer em botão com resposta já escrita?**
- O que se passa: fica decidido **como** se constrói (`CLAUDE.md §19`) mas não **o que diz**. As
  respostas em botão são conteúdo da loja, não código — sem elas a camada guiada nasce vazia, e sem
  saber quem responde no POS a camada humana nasce a mentir ao cliente.
- Por decidir também: se a conversa fica ligada ao pedido (`chat_threads.order_id`) para o caixa ver
  de quem está a falar, e ao fim de quantos minutos sem resposta entra o **deep link do WhatsApp**
  (proposta: 3 min).
- Como avancei: **nada escrito** — não há código nem migration. Não bloqueia nada da Fase 1, porque
  não é nenhum dos cinco não-negociáveis da abertura (§0). Não entra no pacote da abertura.
- Onde está: [`CLAUDE.md §19`](CLAUDE.md) · [`ROADMAP.md` G9](ROADMAP.md) — sem marcador no código,
  porque ainda não há código
- Se a resposta for outra: nada muda no que já está feito. Muda o conteúdo de `chat_topics` e quanto
  do widget é guiado versus humano — decide-se antes de abrir a G9, não durante.

---

### B-022 · [F0] O ambiente `production` do Railway está vazio e segue o ramo `dev`

**Troca em 29/09/2026:** a loja de Maputo já vendia no staging (`pqjoan…`) desde 22/09 — 340 pedidos,
POS e bridge ligados. Em vez de copiar tudo para o `hawsmash2`, esse projecto passou a ser o LIVE
([ADR 0008](docs/decisions/0008-staging-passa-a-live.md)). As cinco variáveis Supabase e o
`CRON_SECRET` de `production` são agora as do staging; `APP_BASE_URL` e `NEXT_PUBLIC_APP_BASE_URL`
passaram a `https://hawsmash.com`. `main` avançou para `dfd79e4` e o deploy saiu verde: o bundle
contém `pqjoan…` e nenhuma referência ao `hmutpt…`, o cardápio é igual ao do staging (5 categorias,
26 itens) e a guarda de placeholders passou. Antes disso, a 1077/1078/1106 foram aplicadas nesta base
(a 1106 repõe a variante no nome do talão — sem ela a bridge da loja imprimia um WAGYU como o HAW).
Pendentes: transferir o projecto da org "QR Mesas" (gratuita) para a org Pro e recriar o staging.

**Promoção em 28/09/2026 (~17:30):** a 1100 foi aplicada primeiro no staging
(estava em `dev` sem estar lá). Depois, as 34 migrations `1062`…`1105` de `dev`
foram aplicadas no LIVE `hmutptcbusxncnofinrw` com `supabase db push`, sem erros
(referência PITR: `2026-09-28T15:29:32Z`). Ficaram de fora a `1077`, a `1078` e a
`1102`, que não estão commitadas, e as quatro do `codex/vendedora-virtual` já
aplicadas no staging. `main` avançou para `dev` (`ee4b967`). O primeiro build foi
travado pela guarda por causa da zona da Matola, `PLACEHOLDER_ZONA`, que foi
renomeada para `Matola` (150 MT) por decisão do Gabriel. O LIVE continua sem
equipa, e o domínio continua no 1.0.

**Actualização verificada em 28/09/2026 (preparação LIVE):** as cinco variáveis
Supabase de `production` apontam agora apenas para `hawsmash2`
(`hmutptcbusxncnofinrw`), nunca para staging. Foram também preparados
`APP_BASE_URL`, `NEXT_PUBLIC_APP_BASE_URL`, `BRAND_NAME`, `PAYMENT_PROVIDER=manual`,
`EMAIL_FROM`, `RELEASE_GUARD=1` e um `CRON_SECRET` próprio. Estas alterações foram
feitas com `--skip-deploys`: **a versão publicada ainda não as usa**. As chaves
permitiram uma leitura autenticada da base LIVE; a migration 1096 não está lá
(`google_profile_snapshots` e `get_monthly_digest` ausentes). Última migration
LIVE `1061`, enquanto staging já avançou além da 1105. O commit LIVE `07fec24`
responde 404 em `/api/cron/monthly`. Não promover antes de reconciliar a cadeia
de migrations, validar staging e resolver B-002; o domínio `hawsmash.com` continua
no 1.0.

**Actualização verificada em 28/09/2026:** o serviço `hawsmash2` no ambiente
Railway `production` segue agora `main`. Foram configurados `SMTP_USER`,
`SMTP_PASS` e `OWNER_EMAIL=haw@hawsmash.com`; a autenticação SMTP com a Hostinger
passou e `/api/health` respondeu 200. Continuam ausentes as variáveis Supabase e
`CRON_SECRET`. O commit publicado (`07fec24`) não contém `/api/cron/monthly`.
Logo, o email mensal LIVE ainda não funciona; a configuração SMTP não significa
que o ambiente esteja pronto para vendas ou relatórios. As notas antigas abaixo
documentam a evolução do bloqueio.

**Revisão documental (26/09):** o registo de 24/09 em `docs/modulos/relatorios.md`/ROADMAP informa que o trigger Railway passou para main. Essa parcela deixou de estar pendente; credenciais, equipa, DNS e validação de produção não foram reconsultados nesta auditoria. As notas de Agosto abaixo são história, não retrato actual.


- Estado: **aberto — descoberto em 2026-08-28, ao verificar o B-016**
- Desbloqueia: Gabriel (painel do Railway) + decisão sobre qual é a base de dados LIVE
- Pergunta exacta: o ambiente `production` do projecto `hawsmash2` serve para quê — e de que ramo e
  de que Supabase deve viver?
- O que se passa: além do `staging`, o projecto tem um ambiente **`production`** com o serviço
  `hawsmash2`. Três coisas ao mesmo tempo:
  1. **Segue o ramo `dev`.** Cada push para `dev` passa a construir também produção. Isso contradiz
     o `CLAUDE.md §2` (`dev → staging`, `main → live`) e, no dia da abertura, poria em produção
     código que ainda não foi testado em lado nenhum.
  2. **Não tem uma única variável da aplicação.** `railway variables list -e production` devolve só
     as que o próprio Railway injecta — nem Supabase, nem Paysuite, nem Resend. Não é um ambiente
     mal configurado: é um ambiente que nunca foi configurado.
  3. **O build de hoje falhou** (`98142c55`, 00:14 UTC) e o que continua a servir é um build de
     2026-08-25. Um ambiente que serve o passado sem ninguém dar por isso é o mesmo género de mentira
     do B-016.
- Como avancei: a causa da falha era código e está corrigida (`7e8a95c` — o cron das conversões
  prerenderizava sem Supabase). A configuração do ambiente **não** lhe toquei — decidir para que
  serve é do dono.
- **Estado depois da correcção (2026-08-28, 08:55 UTC):** o push para `dev` construiu os dois
  ambientes; staging ficou `SUCCESS` e produção **também subiu** — `hawsmash2-production.up.railway.app`
  responde `{"status":"ok"}` no `/api/health` e serve o site. É esse o problema: **parece vivo**.
  Sem Supabase configurado não tem lojas, cardápio, pedidos nem caixa; é a casca da aplicação num
  endereço com a palavra "production" no nome. Se alguém der esse link ao cliente por engano, o que
  ele vê é o sistema a fingir que existe.
- Onde está: Railway → projecto `hawsmash2` → ambiente `production` → serviço `hawsmash2`
  (`hawsmash2-production.up.railway.app`)
- **Actualização (2026-08-31):** a parte do Supabase já está decidida e feita — `hawsmash2`
  (`hmutptcbusxncnofinrw`) é o LIVE definitivo, separado do `hawsmash2-staging`
  (`pqjoanrsjkddkjsllqov`, que fica só para testar). As 103 migrations foram aplicadas, o seed de
  configuração correu (lojas, horários, números de pagamento, cardápio) e o histórico do 1.0 foi
  importado para Maputo (ver [B-009](#b-009--f9-acesso-ao-supabase-do-hawsmash-10) resolvido). Falta
  só a parte do Railway: apontar o ambiente `production` ao ramo `main` (não `dev`) e preencher as
  variáveis (`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` do `hawsmash2`, Paysuite, Resend).
- Se a resposta for outra: minutos — ou se aponta o ambiente ao ramo `main` e se preenchem as
  variáveis, ou se apaga o ambiente até haver data de cutover (B-010).

---

### B-100 · [F6] M-Pesa directo: credenciais e endereços da Vodacom

- Estado: **aberto — descoberto em 2026-09-03, ao construir o M-Pesa directo**
- Desbloqueia: cliente (conta M-Pesa de empresa) + Vodacom (onboarding da API)
- Pergunta exacta: qual é a **chave da API**, a **chave pública**, o **código do comerciante**, e
  quais são os **endereços com porta** de sessão, cobrança e consulta de estado?
- O que se passa: o motor já cobra por M-Pesa directo — provider, sessão cifrada, cobrança,
  consulta de estado, reconciliação e ecrã de espera, tudo testado contra simulador. O que falta é
  aquilo que só a Vodacom dá.
- **As portas são o detalhe traiçoeiro:** o M-Pesa usa endereço e porta diferentes por operação e
  por ambiente. Um número inventado aqui seria plausível o suficiente para chegar a produção sem
  ninguém reparar — por isso ficam como `PLACEHOLDER_MPESA_*` no `.env.example` e a loja marcada
  como `mpesa` sem credenciais cai no comprovativo manual em vez de fingir que cobra.
- Contornado com: `payment_provider = 'mpesa_sim'` (simulador) para ensaiar o fluxo inteiro,
  incluindo o cancelamento, o saldo insuficiente e o tempo esgotado.
- Também por confirmar: a conta M-Pesa de **empresa** e o onboarding na API não são imediatos.
  Vale a pena começar isso antes de haver data de abertura.

---

### B-101 · [F0] Cinco suites de integração nunca correram — e estão desactualizadas

**Revisão documental (26/09):** mantêm-se cinco ficheiros sob describe.skip (42 declarações textuais), apesar de suites cash-v2/stock-v2 activas. Teste raiz não executa testes de BD.


- Estado: **aberto — descoberto em 2026-09-03**
- Desbloqueia: nós
- O que se passa: `cash`, `payments`, `referral`, `stock` e `tracking` apontavam para
  `localhost:54531`. A porta deste projecto é a **54731**. Falhavam no arranque, portanto
  **nunca correram contra base de dados nenhuma** — e ninguém deu por isso, porque não estão na
  lista do `test:db` (o gate).
- A porta foi corrigida. Ao voltarem a correr, mostraram-se desactualizadas face ao schema **e a
  deixar a base de dados suja para as suites seguintes** — chegaram a partir o `pos.test.ts` e o
  `rls-permissive.test.ts`, que passam com a base de dados limpa.
- Contornado com: `describe.skip` com este ID no cabeçalho de cada ficheiro. Ficam suspensas e não
  apagadas: **um teste que não corre é pior do que um teste que não existe**, porque parece
  cobertura.
- Para fechar: actualizar cada suite ao schema de hoje, garantir que limpa o que suja, e metê-la na
  lista do `test:db`.

---

### B-102 · [F6] `account` e `recipes` falham contra a base de dados local

- Estado: **aberto — descoberto em 2026-09-03**
- Desbloqueia: nós
- O que se passa: com a base de dados acabada de repor, duas suites fora do gate falham por razões
  diferentes, nenhuma relacionada com pagamentos:
  - `account.test.ts` espera o telefone como `+[contacto privado omitido]` e recebe `[contacto privado omitido]` — a migration
    1038 mudou a normalização e o teste ficou para trás.
  - `recipes.test.ts` espera consumo de matéria-prima e não há nenhum: `recipe_items` fica **vazia**
    depois de um `db reset` local, apesar de a 1027 existir para a preencher.
- O segundo é o que interessa mesmo: se a ficha técnica não é semeada, o consumo por variante não
  está a ser exercitado por teste nenhum — e é ele que desconta a carne certa.

---

### B-103 · [A1] Canal de agentes: activação HTTPS e validação da instalação

- Estado: **aberto — 2026-09-14**
- Categoria: **infraestrutura/domínio**. Desbloqueia: Gabriel, com acesso ao deploy e domínio da instalação.
- O que falta: publicar a versão em staging, configurar `AGENT_PUBLIC_BASE_URL` para a origem
  HTTPS correcta e activar `AGENT_TOOLS_ENABLED`; confirmar RPCs com a chave pública e testar
  lojas, escolhas, zonas e chegada ao checkout. Se houver várias réplicas, configurar também
  limite agregado no proxy antes da exposição pública.
- Como avancei: ferramentas, validação, revisão do carrinho e pacote de plugin implementados;
  testes locais e ensaio com RPC simulado. A flag fica **desligada por omissão**. Não foi
  declarada nem efectuada nesta entrega a activação pública desta integração em produção.
- Onde está: [`docs/modulos/agentes.md`](docs/modulos/agentes.md), `.env.example`, `apps/web/lib/agents/`,
  `playwright.agents.config.ts` e `scripts/smoke-public-mcp.mjs`.
- Para fechar: ligação SDK ao MCP HTTPS e percurso completo até à revisão/checkout de staging,
  sem cobrança real; registar domínio, versão e resultado. A ausência deste canal não altera
  a venda pelo site/POS existente.
- Custo/tempo: usa o deploy da instalação; eventual alteração de plano depende da infraestrutura.
  Estimativa de 30–60 min depois de domínio e acesso estarem disponíveis.

---

### B-104 · [A1] Canal de agentes: ligação e publicação no ChatGPT

- Estado: **aberto — 2026-09-14**
- Categoria: **publicação**. Desbloqueia: Gabriel/conta destinatária e processo de validação da plataforma.
- O que falta: gerar o pacote para o domínio validado em B-103, testar a ligação na conta
  destinatária, preencher identidade/marca e política de privacidade da instalação e completar
  o processo de submissão/publicação aplicável. Publicar o endereço MCP ou gerar um ZIP não
  instala o plugin nas contas dos clientes nem garante descoberta no ChatGPT.
- Como avancei: pacote reutilizável e gerador prontos, com as quatro ferramentas públicas e
  instruções de uso. O checkout final continua no domínio do restaurante e exige acção humana.
  Nenhuma submissão, aprovação de directório ou instalação na conta do utilizador foi verificada.
- Onde está: [`plugins/restaurant-os/README.md`](plugins/restaurant-os/README.md),
  `scripts/package-agent-plugin.mjs`, [`docs/modulos/agentes.md`](docs/modulos/agentes.md) e
  [ADR 0005](docs/decisions/0005-canal-publico-de-agentes.md).
- Para fechar: documentar ligação funcional na conta destinatária e o estado real da publicação,
  incluindo eventuais condições da plataforma. Metadados do restaurante são dados por instalação.
- Custo/tempo: preparação estimada em 30–60 min com os dados prontos; aprovação e disponibilidade
  dependem da plataforma e não têm prazo confirmado nesta entrega.

---

### B-105 · [V1] Validar paginação de pedidos na BD da instalação

- Estado: **aberto — 2026-09-14**. Categoria: **infraestrutura/validação**. Desbloqueia: Gabriel.
- Falta: aplicar a migration 1045 em staging e executar SQL/policies com perfis e lojas distintos,
  mais de 100 pedidos, filtros e páginas vazias. O stack Supabase local/Docker não estava disponível.
- Contorno: migration forward-only e testes preparados; UI recusa uma resposta incoerente da RPC
  antiga. Não aplicar o frontend desta alteração antes da migration.
- Onde: `supabase/migrations/20260913225235_1045_paginacao_pedidos.sql`, painel Pedidos,
  testes SQL em `supabase/tests/` e [`docs/planos/volume.md`](docs/planos/volume.md).
- Para fechar: registar versão da BD, resultado dos testes e ensaio dos perfis na instalação.
  Ensaios de browser com RPC simulada não comprovam RLS nem execução da migration.
- Evidência local adicional: a semântica SQL foi ensaiada num Postgres 17.5 embebido (PGlite),
  com esquema/roles de teste. Isto não substitui as policies, triggers e PostgREST da instalação.
- Código local concluído e dois ensaios de navegador passaram. Relatório dos 24 casos SQL em
  [`docs/validation/1045-paginacao-local.md`](docs/validation/1045-paginacao-local.md).

---

### B-106 · [V1] Reconciliação contínua no ambiente real de ensaio

- Estado: **aberto — 2026-09-14**. Categoria: **infraestrutura/integração**. Desbloqueia: Gabriel, com o fornecedor.
- Falta: configurar `CRON_SECRET`, scheduler único por instalação e contas por loja; validar
  `nextCursor` até `completed`, tempos limite e respostas de M-Pesa/Paysuite em ambiente de ensaio.
- Contorno: reconciliação por loja com testes locais, pool limitado e cancelamento. Sem segredo a
  rota fica fechada. Não foram feitas consultas ou cobranças reais nesta preparação.
- Limites: sem lease distribuído; `providerFailed` é sinalizado na resposta e não muda o estado.
  Transição auditada para falha definitiva, alerta persistente e controlo distribuído são trabalho V3.
- Para fechar: scheduler com continuidade verificada, contas correctas e relatório de respostas
  conhecidas/desconhecidas. Ver [`docs/planos/volume.md`](docs/planos/volume.md).
- Código local concluído: 16 testes novos cobrem contas por loja, paginação, autenticação,
  limites e cancelamento; nenhum destes testes consultou o gateway real.

---

### B-107 · [V1] Formato do extracto e ligação às referências internas

- Estado: **aberto — 2026-09-14**. Categoria: **fornecedor/dados**. Desbloqueia: cliente/Gabriel/Vodacom.
- Falta: amostra anonimizada do extracto oficial, descrição das colunas, referência de transacção,
  fuso/data de liquidação, taxas/devoluções e forma autorizada de obter todas as páginas diariamente.
- Contorno: contrato normalizado, função pura, CLI local e testes com 1.500 movimentos, diferenças,
  duplicações, pendências e lojas distintas. O exemplo é detectável como `PLACEHOLDER_*`.
- Decisão: não inventar CSV/API do banco. Taxas e devoluções aparecem para revisão; nenhuma
  conferência altera o estado do pedido ou do pagamento.
- Para fechar: adaptador testado contra a amostra, exportação completa por período/loja e posterior
  integração auditada no painel. A amostra desbloqueia o adaptador, não prova a automação completa.
- Onde: `packages/payments/src/statement.ts`, `scripts/reconcile-payment-statement.ts` e plano de volume.
- Código local concluído: 17 testes de domínio/CLI passaram; adaptador e integração real continuam abertos.

---

### B-108 · [V1.1/V1.2] Validar configuração e transições de e-Mola em staging

- Estado: **aberto**. Categoria: **infraestrutura/validação**. Desbloqueia: Gabriel.
- Falta: aplicar 1046/1047/1048 antes do frontend e validar RPCs, policies, triggers,
  perfis e PostgREST reais da instalação. O stack Supabase local completo não está disponível.
- Contorno: testes de domínio/configuração/handlers, navegador simulado e SQL embebido.
  As migrations não activam cobranças em lojas existentes.
- Para fechar: ensaiar owner/manager/anon, isolamento, idempotência, recusa de troca de
  fornecedor com pagamentos pendentes, guarda da integração real e confirmação sem baixar pagos.
- Evidência e limites em `docs/validation/`; configuração em `docs/modulos/pagamentos.md`.

---

### B-109 · [V1.2] Contrato e acesso à integração directa Movitel

- Estado: **aberto**. Categoria: **fornecedor/integração**. Desbloqueia: Gabriel/cliente/Movitel.
- Direcção confirmada: **e-Mola directo, sem Paysuite**, ao lado de M-Pesa directo.
  A opção anterior via Paysuite foi substituída para esta instalação; o motor mantém
  esse adaptador para instalações que o utilizem.
- Falta: conta de comerciante por loja, contrato técnico oficial, ambientes, autenticação,
  unidades/limites, criação/consulta, idempotência, códigos de estado e recuperação de
  resposta perdida. Se houver callback, também assinatura e reenvios. Tarifas a confirmar
  directamente com a Movitel; não foi presumido custo zero.
- Contorno: `emola_provider=emola_sim` em desenvolvimento/teste. API/RPC recusam cobranças
  `emola` reais; o simulador também é recusado em produção. Nenhum endpoint ou segredo inventado.
- Para fechar: implementar o adaptador e credenciais a partir do contrato, substituir
  as guardas por validação real em nova migration e ensaiar no ambiente do fornecedor.
  Não basta inserir uma chave. Configurar a reconciliação em B-106.
- Pesquisa: não encontrámos documentação técnica pública oficial suficiente na
  [página e-Mola Movitel](https://www.movitel.co.mz/digital-services/emola).
  O [atendimento oficial](https://www.movitel.co.mz/support/warranty-service-point)
  indica a linha geral 100; a ausência na pesquisa não demonstra inexistência de API.

---

### B-110 · [POS] Validar a entrada por cartão + PIN contra um Supabase real

**Revisão documental (26/09):** `docs/planos/live.md` regista o gate SQL 11/11 em staging a 22/09. O SQL já tem evidência de ensaio; continua pendente a entrada real por cartão no terminal, com caixa/gerente. Não confundir o título “fechado” desse registo com conclusão de todo o bloqueio.


- Estado: **aberto**. Categoria: **infraestrutura/validação**. Desbloqueia: Gabriel.
- Falta: aplicar a 1049 em staging e correr `packages/db/tests/pos-card-login.test.ts`
  (isolamento por loja, travão de tentativas, recusa da verificação ao browser). O stack
  Supabase local não está disponível nesta máquina, logo o SQL não foi executado.
- Falta também confirmar em staging a abertura de sessão sem palavra-passe
  (`auth.admin.generateLink` + `verifyOtp`) com o provedor de email **activo** no projecto:
  é o único passo da entrada por cartão que depende de configuração do Supabase, e sem ele
  a rota `/api/pos/login` responde 503 e o POS manda entrar por email.
- Contorno: o ecrã de entrada por email continua a existir (vincular terminal, criar PIN),
  e o desbloqueio de quem já tem sessão usa a RPC antiga `unlock_pos_device`.
- Para fechar: 1049 aplicada, gate verde em staging, e uma entrada real pelo cartão num
  terminal com os dois perfis (caixa e gerente).

---

### B-111 · [Análise] Validação da nova interface em staging

- Estado: **aberto**. Categoria: **infraestrutura/validação**. Desbloqueia: Gabriel.
- Vendas e Aquisição verificadas com RPCs/sessões simuladas e capturas desktop/móvel. Nesta corrida não se usou sessão real de staging nem se publicou a alteração.
- Para fechar: publicar a branch `dev` no staging e conferir números, filtros de loja/período e CSV com um dono e um gerente reais. Sem cobrança, sem migrations e sem alteração de vendas.
- A auditoria automática A/AA cobre `.insights`. A sidebar/barra global ainda não foi migrada; a revisão com leitor de ecrã e a avaliação integral WCAG permanecem por fazer.

---

### B-112 · [Exportação] Formato de importação no software certificado

- Estado: **aberto**. Categoria: **fornecedor/integração**. Desbloqueia: Gabriel + contabilista/parceiro WinREST.
- Falta: software, versão, módulo de importação/API e ficheiro-modelo oficial. Também o mapeamento fiscal da instalação (artigos, impostos, NUIT, séries e referências externas).
- Contorno entregue: CSV documentado padrão/Excel, por pagamento ou por pedido, sem duplicar totais de pagamentos mistos; não se inventou SAF-T, IVA, NUIT ou números de factura.
- Para fechar: implementar adaptador a partir do contrato real e validar numa empresa de ensaio, incluindo reimportação sem duplicados, pagamentos mistos, descontos e devoluções. Não foi emitida qualquer factura externa.
- Pesquisa, contrato do CSV e limites: `docs/modulos/relatorios.md`.

---

### B-113 · [TVs] Tecto de upload do projecto Supabase para vídeos

- Estado: **aberto**. Categoria: **acesso/infraestrutura**. Desbloqueia: Gabriel.
- O bucket `tv-media` (1090) aceita até 200 MB por ficheiro, mas o Supabase tem um tecto **global** por
  projecto (50 MB por omissão; no Free não passa de 50 MB). Um vídeo acima disso é recusado no upload — o
  painel explica e pede para exportar em 1080p, mas não passa.
- Como avancei: limite no bucket e validação no browser; mensagem clara quando o servidor recusa.
- Para fechar: no projecto `hawsmash2` (Pro), *Settings → Storage → Upload file size limit* = 200 MB (5 min).
  No staging (Free) fica em 50 MB — chega para ensaiar.

---

### B-114 · [Resumo mensal] Google e agendador para o email do dia 1

**Actualização 28/09/2026 (separação dos ambientes):** os jobs `app-digest` e
`app-monthly` foram removidos do Supabase staging e a ausência foi confirmada,
para não enviar dados de teste ao dono após activar o SMTP. O LIVE ainda não tem
`pg_cron` instalado, a migration 1096 nem a rota publicada. O `CRON_SECRET` LIVE
já foi preparado no Railway, sem deploy; o Vault e os jobs LIVE serão configurados
depois da promoção segura. O SMTP está autenticado nos dois ambientes, mas a
entrega de um email real ainda não foi confirmada.

**Actualização verificada em 28/09/2026:** a caixa `haw@hawsmash.com` está activa
na Hostinger. Uma palavra-passe de aplicação foi configurada como `SMTP_PASS` no
serviço `web` do Railway **staging**, com `SMTP_USER=haw@hawsmash.com`. O deploy
das duas variáveis terminou, `/api/health` respondeu 200 e a autenticação SMTP
em `smtp.hostinger.com:465` passou (`SMTP_OK`). Ainda **não foi enviado nem
recebido um email de teste**; os envios dos relatórios e o disparo natural do cron
continuam por validar. O SMTP foi também configurado e autenticado no Railway
`production`, mas o resumo mensal LIVE depende ainda do B-022. Places API e o
perfil da Matola continuam pendentes.
As notas de 27/09 abaixo descrevem o estado anterior à configuração SMTP.

**Actualização verificada em 27/09/2026:** 1096 aplicada em staging; 1101 corrige
o regex `{10,512}` que o PostgreSQL rejeitava. Teste SQL reproduziu a falha e passou
após a correcção. Railway staging publicou o resumo e a secção Google (deploy
`a35a9bdd-39c1-4964-81e6-1466b2ae38ea`, base `5e2f54c` com os ficheiros do resumo
e autenticação dos crons; restantes alterações locais preservadas).
`CRON_SECRET` está no Railway/Vault e `OWNER_EMAIL=haw@hawsmash.com` no Railway.
Jobs `app-digest` (`0 6 * * *`, dia anterior de Maputo) e `app-monthly`
(`0 6 1 * *`) activos. Pedidos HTTP reais chegaram à aplicação com 200;
**ambos omitiram email por falta de SMTP**. Disparo natural do relógio por observar.
O instalador está em `scripts/sql/install-report-crons.sql`; usa `http` síncrono no
cron para não colocar o Bearer na fila `pg_net`, cujos grants a PUBLIC pertencem
a `supabase_admin` nesta instalação. A fila não é usada pelos jobs finais.

Maputo: Place ID `ChIJ582Y7VKb5h4RAj_5ZLpRQrI`, perfil do Elite Padel Club / Hotel
Glória, confirmado no Google Maps. Matola: pesquisa só devolveu Maputo; não usar
o mesmo ID nas duas lojas. Nenhum projecto HAWSMASH apareceu na conta Google Cloud
aberta; nenhuma facturação, subscrição ou chamada paga foi activada.

**Falta nesta instalação:** `SMTP_USER`/`SMTP_PASS` (a documentação do 1.0 indica um
segredo de Edge Function; não está nas variáveis Railway consultadas), projecto Google Cloud
autorizado com facturação e Places API (New), chave restrita à API. O ambiente
Railway production continua sem variáveis Supabase/SMTP (B-022); não foi ligado à
base de staging nem ao 1.0. A recepção do email e a leitura da API Google não foram
validadas. Os requisitos GBP abaixo continuam fora da parcela Places instalada.

- Estado: **aberto**. Categoria: **acesso/infraestrutura**. Desbloqueia: Gabriel (com o dono, para o acesso ao perfil).
- Pedido do dono: no dia 1 de cada mês, o email da casa recebe o resumo do mês e, no mesmo email, a loja no Google.
- O que já faz (1096): `/api/cron/monthly` monta e envia o resumo — vendas por loja face ao mês anterior,
  canais, pagamentos, mais vendidos — e a nota e o número de avaliações de cada loja (Places API). Sem chave
  ou sem Place ID, o email sai na mesma e diz, por loja, o que falta.
- Falta, por ordem:
  1. **Scheduler.** Nada chama a rota sozinho no 2.0 — o mesmo buraco do B-106 (o digest diário também não
     corre). `GET /api/cron/monthly` com `Authorization: Bearer $CRON_SECRET`, cron `0 6 1 * *` (UTC = 08h Maputo).
  2. **`CRON_SECRET`** e **`OWNER_EMAIL`** (a caixa da casa) no Railway do ambiente que envia. Sem segredo a rota
     responde 503 — desde `fix/violacoes-spec` (26/09) todos os crons fecham assim (R-02 da auditoria).
  3. **`GOOGLE_PLACES_API_KEY`**: projecto Google Cloud com facturação, *Places API (New)* activada, chave de
     servidor restrita a essa API. Duas leituras por mês.
  4. **Place ID** de cada loja na aba **Lojas** (localizador de Place ID do Google). Loja sem perfil próprio no
     Google fica "por ligar".
  5. **Métricas do Perfil de Empresa** (visualizações, chamadas, pedidos de direcções, cliques no site): pedir
     *Application for Basic API Access* no formulário da GBP API, com o número do projecto Google Cloud e um email
     dono/gestor do perfil. Requisitos do Google: perfil verificado e activo há 60+ dias e site no perfil. Quota 0
     até aprovar, sem prazo garantido. Depois: OAuth `business.manage` com a conta gestora e
     `fetchMultiDailyMetricsTimeSeries` por loja, na mesma rota.
- Limites honestos:
  - O Google só dá o número de hoje. A variação de avaliações do mês aparece a partir do **2.º resumo** — o 1.º é a
    primeira fotografia. Um mês antigo reenviado sem fotografia sai sem a parte do Google.
  - Enquanto o `hawsmash.com` for o 1.0 (B-010), as vendas reais estão no 1.0: o resumo do 2.0 mostra o que o 2.0
    vendeu.
- Para fechar: resumo recebido na caixa da casa com as duas lojas e a nota de cada uma; pedido de acesso GBP aprovado
  e métricas no email.

---

### B-115 · [Segurança] Aplicar 1097–1099 e o código das correcções da auditoria

- Estado: **aberto — parcela SQL feita**. Categoria: **acesso/infraestrutura**. Desbloqueia: Gabriel.
- **27/09:** 1095 e 1097–1099 aplicadas no staging pelo Gabriel (`migration list` confirma); `fix/violacoes-spec`
  mesclado em `dev` localmente. Faltam os passos 2–6 abaixo. A 1100 (reimprimir o fecho do dia) segue o mesmo caminho.
- O que é: o branch `fix/violacoes-spec` corrige 13 violações e 4 riscos da auditoria de 26/09
  ([§5.1](docs/AUDITORIA-DOCUMENTACAO.md)). Três migrations (`1097_estado_e_pagamento_por_perfil`,
  `1098_sangria_idempotente`, `1099_isolamento_de_dados`) e código do painel, POS e rotas. Provado numa BD
  local ([evidência](docs/validation/correcoes-violacoes-2026-09-26.md)); **nada foi aplicado em staging nem no LIVE**.
- Porque não avancei: o staging é o que o POS de Maputo usa; aplicar a meio do serviço é manutenção em horário de
  loja (§18.4) e mexe em quem pode aprovar e cancelar.
- Para fechar, por esta ordem, **fora do horário**:
  1. `supabase migration list --linked` no staging; aplicar **só** 1097–1099 (procedimento de pasta temporária se a
     1077/1078/1096 de outra sessão ainda estiverem pendentes).
  2. Correr `pnpm --filter @delivery/db test:db --run tests/permissoes-e-isolamento.test.ts` contra o staging **com a
     bridge desligada** (o travão da suite pára se estiver viva).
  3. **`CRON_SECRET`** preenchido no Railway de cada ambiente e no scheduler: sem ele, alerts/digest/conversions
     passam a responder 503 (antes corriam abertos).
  4. Deploy do código (merge de `fix/violacoes-spec` em `dev`). A ordem migration → código não é obrigatória para a
     sangria (o POS cai para a assinatura antiga), mas é para o resto.
  5. Ensaio curto no POS: caixa aprova e recusa um pedido online; caixa **não** consegue cancelar uma venda paga
     (recebe a mensagem do gerente); sangria com rede a falhar não duplica; o PDF do fecho descarrega; o email de
     fecho chega ao dono (antes nunca chegava — R-03).
  6. `RELEASE_GUARD=1` só no ambiente LIVE do Railway, quando existir.
- Se correr mal: `advance_order`/`confirm_payment` voltam atrás com uma migration nova que repõe a 1062; os grants da
  1099 revertem-se com `grant`. Nada apaga dados.

---

### B-116 · [Equipa] A cozinha vê dinheiro (V-03)

- Estado: **aberto**. Categoria: **decisão técnica**. Desbloqueia: Gabriel.
- Pergunta exacta: esconder totais e pagamentos à cozinha vale uma mudança de schema agora, ou basta a cozinha não
  ter contas próprias até à Fase 2?
- O problema: a RLS decide **que linhas** cada um vê, não **que colunas**. `orders`, `order_items`, `print_jobs` e
  `get_orders` devolvem valores a quem vê o pedido, e o perfil `kitchen` vê os pedidos da loja (CLAUDE §6: "não vê
  dinheiro"). O painel esconde; uma chamada directa à API não.
- Como avancei: nada no código. As restantes protecções da cozinha estão feitas (não aprova, não cancela, não abre
  comprovativos — 1097/1099).
- Opções: (a) vista/RPC da cozinha sem colunas de dinheiro e retirar à cozinha o SELECT directo — horas, toca no
  quadro do POS; (b) não criar contas `kitchen` até ao KDS da Fase 2, onde a vista nasce já certa — minutos.
  Recomendo (b) enquanto a cozinha só lê papel.

---

### B-117 · [Bridge] Nome do cliente no executável e na tarefa do Windows (V-10)

- Estado: **aberto**. Categoria: **hardware/instalação**. Desbloqueia: Gabriel, na loja.
- O problema: `build-sea.ps1` e `install-task.ps1` trazem o nome do cliente como omissão (CLAUDE §18.3).
- Porque não mudei: Maputo já tem a tarefa instalada com esse nome. Mudar a omissão e reinstalar criaria uma
  **segunda** tarefa ao lado da antiga — duas bridges a puxar a mesma fila.
- Para fechar, na próxima visita: `uninstall-task.ps1` com o nome antigo, trocar as omissões para um nome neutro
  (ex.: `print-bridge.exe`, "Print Bridge"), reinstalar, confirmar uma só tarefa e um só heartbeat em `devices`.

---

### B-118 · [POS] ADR 0006 diz 2 min; o POS relê definições e cardápio a cada 15 s (V-11)

- Estado: **aberto**. Categoria: **decisão (documentação)**. Desbloqueia: Gabriel.
- Pergunta exacta: confirmar os 15 s e emendar o ADR 0006?
- Contexto: os 15 s são deliberados (`apps/web/lib/pos/offline-store.ts`): a 2 min, um produto marcado como esgotado
  continuava à venda no balcão até ao ciclo seguinte. O custo é uma leitura leve a cada 15 s por terminal.
- Se a resposta for "2 min": uma constante e um teste — minutos.

---

### B-119 · [Bridge] O `.exe` das lojas é anterior às linhas de desconto no talão (1113)

- Estado: **aberto**. Categoria: **hardware/instalação**. Desbloqueia: Gabriel, na loja.
- O problema: a 1113 põe a origem de cada desconto no payload de `print_jobs` e o
  [talão](packages/receipt/src/tickets.ts) imprime uma linha por origem — 2x1 com o produto grátis, cupão com o
  código, desconto manual com o motivo, entrega grátis. O `.exe` instalado em Maputo é do `d530fe2` e não conhece
  essas instruções.
- Como avancei: o talão antigo continua **certo**. O payload traz o `discount_cents` de sempre, por isso a bridge
  instalada imprime a linha única "Desconto:" com o valor total correcto — menos detalhada, não errada. Nada
  bloqueia a venda (CLAUDE §1).
- Onde está: [`packages/receipt/src/tickets.ts`](packages/receipt/src/tickets.ts),
  [`promo-lines.test.ts`](packages/receipt/src/__tests__/promo-lines.test.ts) e o trigger
  `private.print_job_promotions` da 1113.
- Para fechar: gerar o `.exe` de um commit com a 1113, trocá-lo nas duas lojas **mantendo o mesmo nome de ficheiro
  e a mesma tarefa** (ver **B-117**, que tem de ser resolvido na mesma visita para não ficarem duas bridges), e
  conferir num talão real com um 2x1 e um desconto manual.
- Se não for trocado: o dono não vê no papel de onde veio o desconto. O painel e o email mostram-no de qualquer
  forma; o motivo do desconto manual fica só nesses dois sítios.

---

## ARQUIVO — resolvidos

### B-009 · [F9] Acesso ao Supabase do HAWSMASH 1.0
- Estado: ✅ resolvido (2026-08-31)
- Desbloqueia: Gabriel
- Pergunta exacta: service key (só leitura, se possível) do projecto `tsrgileifpiaiicwjfar` para a importação.
- Como avancei: a chave veio da própria CLI do Supabase (`supabase projects api-keys`, já autenticada na
  conta que é dona dos dois projectos) — não foi preciso pedir nada a ninguém. Corri o dry-run contra dados
  reais e apareceram dois bugs que os fixtures nunca tinham exercitado: `mapOrderStatus` não sabia o quê fazer
  a `delivered` (682 dos 714 pedidos do 1.0 estão nesse estado, só 5 estão `paid`) e `fulfillment='yango'`
  caía como `pickup` em vez de `delivery`. Corrigidos os dois em `scripts/lib/import-mapping.ts` + testes.
  Também descobri que `menu_categories`/`menu_items` não têm unique constraint em `name`, por isso o
  `upsert(onConflict:'name')` falhava sempre — trocado por select-then-insert-or-update.
  Corrido `--apply --i-know-this-is-live` para `maputo` no projecto `hawsmash2` (`hmutptcbusxncnofinrw`):
  **714 pedidos, 1494 linhas de item, 381 clientes, 4 categorias, 15 produtos** — confirmado por contagem
  directa na BD depois. Matola ficou sem histórico (o 1.0 só teve a loja de Maputo).
- Onde está: `scripts/import-hawsmash-1.ts` · `scripts/lib/import-mapping.ts`
- Se a resposta for outra: já corrido — só relevante se aparecer um 2.º lote de pedidos do 1.0 para reimportar.

---

### B-016 · [F0] Deploy automático do Railway a partir de `dev`
- Estado: ✅ **RESOLVIDO (2026-08-28)** — reconectado pelo Gabriel no painel do Railway
- Desbloqueia: Gabriel (painel do Railway)
- Pergunta exacta: — (é reconectar a origem, não é pergunta)
- O que se passa: o `git push origin dev` **não dispara build nenhum**. O último deploy automático
  é de 2026-08-22 13:20. Confirmado de duas formas: estado do deploy pelo CLI, e o `/pos-sw.js`
  publicado a servir a versão antiga depois de um push. A ligação ao GitHub caiu algures.
- Porque importa: o fluxo `dev → testar staging → merge main` do `CLAUDE.md §2` deixa de funcionar
  sozinho. O risco não é o deploy falhar — é alguém corrigir uma coisa, meter no `dev`, e ficar
  convencido de que está em staging quando não está. Isso mente sobre o que foi testado.
- Como avancei: publiquei por CLI (`railway up --detach`) com o projecto ligado a esta pasta.
  Funciona e é rápido (~80 s), mas é manual e depende de mim estar à frente do teclado.
- Onde está: painel do Railway → projecto `hawsmash2` → ambiente `staging` → serviço `web` →
  Settings → Source. Domínio: `web-staging-7805.up.railway.app`
- Se a resposta for outra: minutos — reconectar o repositório e escolher o ramo `dev`.
- **Tem de estar resolvido antes da abertura.**
- **2026-08-26 — este bloqueio já custou um dia de diagnóstico.** O balcão não conseguia fechar
  vendas de entrega: dava `payment_total_mismatch`. Procurou-se o erro na base de dados e no código
  do POS, e os dois estavam certos — a RPC de staging aceita a venda de entrega com a taxa, provado
  por reprodução directa contra o staging (300 + 150 = 450, gravada certa). **O que estava errado era
  o site publicado:** o Railway servia o build de 2026-08-22, anterior ao commit `3ed411c` que pôs o
  POS a cobrar a taxa. POS antigo a mandar 300, servidor novo à espera de 450. Confirmado pelo bundle
  publicado: tinha `Zona de entrega` e não tinha `Taxa de entrega`.
  Resolvido no momento com `railway up --detach`. **Enquanto a origem não for reconectada, isto volta
  a acontecer — e volta a parecer um bug do código.**
- **2026-08-28 — fechado e verificado.** O serviço `web` de staging voltou a ter origem
  (`source.repo = NiraslabDEV/hawsmash2`, ramo `dev`). Prova em duas partes: o primeiro build depois
  da reconexão ficou `SUCCESS` às 00:18 UTC no commit `a2ae0ec`, e o push seguinte (`7e8a95c`)
  disparou build **um segundo depois**, sem ninguém correr `railway up`. O `dev → staging` do
  `CLAUDE.md §2` volta a andar sozinho.
- **O domínio de staging mudou com a reconexão.** `web-staging-7805.up.railway.app` responde agora
  **404 Application not found**; o endereço vivo é **`hawsmash2-staging.up.railway.app`**. Quem tiver
  o antigo em favoritos, no `.env` do print-bridge ou no atalho do POS vai bater numa porta fechada
  a pensar que o sistema caiu.
- A reconexão destapou o **B-022**: o mesmo repositório também alimenta um ambiente `production`
  que ninguém configurou.
- **2026-08-31 — a previsão confirmou-se.** O `.env` activo do print-bridge (Maputo e Matola, staging)
  ainda tinha `LOCAL_ALLOWED_ORIGINS=web-staging-7805...`, o domínio morto. Corrigido para
  `hawsmash2-staging.up.railway.app` nos dois ficheiros (`services/print-bridge/.env` e `.env.matola.bak`).

---

## ARQUIVO — pacotes finais de corridas anteriores

### Nota histórica — campanhas

Código preparado e ensaiado em transacção SQL local. A activação exige dono autenticado e staging da instalação; nenhuma campanha foi activada no motor. Ver [Marketing](docs/modulos/marketing.md). Este é o relato da corrida anterior, não um ensaio desta revisão.

Contagens, tempos e estados abaixo pertencem à data de cada corrida. O estado actual está nas entradas do topo; os pacotes não substituem esse registo.

## PACOTE FINAL — para atacar de uma vez só

> Preenchido no fim da corrida (F0→F9). **16 bloqueios abertos**: 6 do cliente, 6 do Gabriel,
> 4 à espera de hardware/agenda. Nenhum impede o sistema de funcionar hoje em staging.

### Para o cliente (mensagem pronta a enviar)

> Olá Ridwan. O sistema das duas lojas já está de pé e a funcionar em ambiente de teste.
> Para fechar, preciso destas respostas — todas rápidas:
>
> 1. **Matola — entregas:** que zonas a Matola entrega e quanto cobra em cada uma? (Neste momento está
>    com uma zona provisória de 150 MT, igual a Maputo.)
> 2. **M-Pesa/e-Mola:** o dinheiro das duas lojas cai na **mesma** conta, ou queres uma conta por loja?
> 3. **Talão:** que texto queres no fim do talão do cliente? (Hoje está "Obrigado! Bom apetite!".) Queres NUIT?
> 4. **Equipa:** quantas pessoas por loja e quem fica como **gerente** em cada uma? (Preciso de nome e email
>    de cada pessoa para criar as contas.)
> 5. **Cartão:** confirmo que o terminal de cartão é do banco e o sistema só regista que foi cartão — certo?
> 6. **TVs:** quantos ecrãs por loja e o que mostra cada um — **cardápio** ou **senhas**?
> 7. **Abertura:** em que dia exacto passamos o hawsmash.com para o sistema novo?
> 8. **Moradas:** qual é a morada exacta de cada loja (Maputo e Matola) para pôr no site e no talão?

| # | ID | Sem isto… |
|---|---|---|
| 1 | B-002 | a Matola não consegue receber entregas com a taxa certa |
| 2 | B-001 | o dinheiro das duas lojas cai todo na mesma carteira |
| 3 | B-005 | o talão sai com o rodapé provisório |
| 4 | B-004 | a equipa entra com contas criadas à pressa no dia |
| 5 | B-003 | (só confirmação — nada bloqueia) |
| 6 | B-011 | as TVs ficam por apontar |
| 7 | B-010 | não há data de cutover |
| 8 | B-015 | o site diz "morada por confirmar" nas duas lojas |

### Para o Gabriel (decisões e acessos)

| ID | O que falta | Custo/tempo |
|---|---|---|
| B-007 | GitHub Pro/Team para **proteger a `main`** (exigir CI verde antes do merge) | subscrição; 5 min a activar |
| B-008 | Destino do `pg_dump` nocturno (Backblaze B2? Drive?) + credencial | decisão + 30 min |
| B-009 | Service key **de leitura** do Supabase do 1.0 (`tsrgileifpiaiicwjfar`) para a importação | 5 min + 1 h de conferência |
| B-012 | Domínio verificado no Resend e remetente dos emails | 30 min |
| B-013 | Projecto Sentry + DSN (web e print-bridge) | 15 min |
| B-014 | Máquina com `pg_dump`/`pg_restore` para o **primeiro teste de restauro** | 30 min |

### À espera de hardware

| ID | O que só se valida com o equipamento | Tempo |
|---|---|---|
| B-006 | Impressão real nas duas cozinhas, **gaveta a abrir**, POS em kiosk no PC touch, watchdog do bridge no Windows | 1–2 h por loja (10 testes de `docs/operacao/hardware.md §4`) |
| B-006 | **Ensaio geral** por loja: 20 vendas, 5 delivery, falha de rede, falha de impressora, fecho de caixa | ~90 min por loja (guião em `docs/operacao/runbook.md §6`) |
| B-018 | Ligar o **visor do cliente** de cada PC touch: porta COM, velocidade e protocolo (CD5220 ou ESC/POS) | 5 min por loja |
| B-011 | Apontar as TVs aos URLs `/tv/[loja]/menu` e `/tv/[loja]/senhas` | minutos |

### Ordenado por impacto na abertura

| Prioridade | ID | Sem isto, na abertura… |
|---|---|---|
| 1 | **B-006** | ninguém garante que o papel sai e que a gaveta abre no equipamento real |
| 2 | **B-004** | a equipa não tem contas nem PIN para trabalhar |
| 3 | **B-002** | a Matola não factura entregas com a taxa certa |
| 4 | **B-009** | abre-se sem o histórico do 1.0 (funciona, mas perde-se o passado) |
| 5 | **B-005** | o talão sai com rodapé provisório |
| 6 | **B-012** | o cliente não recebe email de confirmação (o pedido não pára) |
| 7 | **B-001** | o dinheiro das duas lojas mistura-se numa carteira só |
| 8 | **B-013** | uma falha silenciosa só se descobre por telefonema |
| 9 | **B-008** / **B-014** | há backup do Supabase (PITR), mas não há cópia externa testada |
| 10 | **B-010** | não há data marcada para o cutover |
| 11 | **B-003** / **B-007** / **B-011** | nada bloqueia a venda |

---

---

## PACOTE FINAL — canal de agentes · 2026-09-14

Este pacote cobre apenas a entrega A1; preserva o histórico e a contagem da corrida anterior.
**2 novos bloqueios abertos: 1 de infraestrutura/domínio (B-103), 1 de publicação (B-104),
0 de hardware.** A segunda passagem confirmou que nenhum dos dois é resolvido pelo ensaio local.

### O que ficou feito e o que foi verificado

MCP público, WebMCP, estimativa do pedido por loja, revisão no site e pacote reutilizável de
plugin estão implementados. Schemas estritos, isolamento da loja, opções, dinheiro em centavos,
filtragem de dados e repetição sem escrita têm testes. O ensaio local usou RPC simulado, cliente
oficial MCP e Chrome 152 experimental com WebMCP nativo. O carrinho preparado segue para o
checkout normal após confirmação humana, sem criar encomenda nem iniciar pagamento no agente.
Activação pública e publicação no ChatGPT continuam por validar, em B-103/B-104.

### Para o cliente (mensagem pronta a enviar)

> Estamos a preparar a opção de escolher comida através de um agente e concluir no site do restaurante.
>
> 1. Para apresentar a ligação aos clientes, confirma o nome público, o logótipo e o contacto de apoio do restaurante.
> 2. Envia o endereço da política de privacidade que deve acompanhar esta ligação.

Estes dados completam B-104; não são bloqueios adicionais nem dados para inventar no código.

### Para o Gabriel (decisões e acessos)

| ID | Acção para fechar | Evidência necessária |
|---|---|---|
| B-103 | Publicar e activar em staging da instalação, configurar origem HTTPS e limite do proxy quando aplicável | Cliente SDK e percurso até ao checkout validados nesse domínio, sem cobrança real |
| B-104 | Gerar pacote para esse domínio, ligar à conta destinatária e completar metadados/submissão | Ligação funcional e estado de publicação registados, sem confundir pacote gerado com plugin publicado |

### Hardware e impacto na abertura

Não foi criado nenhum bloqueio de hardware: **0 ensaios físicos adicionais, 0 tempo de hardware**
para este canal. O suporte WebMCP depende da versão/política do navegador e é validado em runtime;
o site continua a funcionar quando a API não existe.

| Prioridade | ID | Sem isto, no dia 1… |
|---|---|---|
| 1 | B-103 | agentes externos não conseguem usar este novo canal no domínio da instalação; site e POS mantêm o percurso existente |
| 2 | B-104 | clientes não têm uma ligação publicada/validada no ChatGPT; gerar o pacote não a substitui |

---

---

## PACOTE FINAL — preparação para volume · 2026-09-14

Esta passagem cobre V1. **3 novos bloqueios: 2 de infraestrutura/integração (B-105/B-106),
1 de fornecedor/dados (B-107), 0 de hardware nesta etapa.** A segunda passagem confirmou
que o ensaio SQL embebido melhora a evidência de B-105, mas não fecha a validação de staging.
Os bloqueios anteriores, incluindo a activação do MCP e publicação no ChatGPT, continuam separados.

### O que ficou preparado e verificado

- Conferência de extractos normalizados, sem escrita financeira, com CLI local e 17 testes.
- Reconciliação por loja, autenticação obrigatória, continuidade por cursor e consultas canceláveis.
- Paginação real no painel e leitura paginada de deliveries activos no POS; filtros no servidor,
  cancelamento de respostas antigas e actualização por nova leitura.
- Motor: **577 testes**, lint/typecheck e build passaram. Dois testes de navegador com RPCs
  simuladas passaram. PostgreSQL 17.5 embebido: **24 casos passaram**; a RPC antiga falhou 22.
  Não foram executados os 13 testes pgTAP contra o stack completo da instalação.

Não foi medida a capacidade de produção nem concluído o conjunto da proposta. Fila por prazo,
agrupamento de entregas, reserva de impressão, marketing, SEO e ensaio de carga continuam no
plano V2–V6 de `docs/planos/volume.md`. Há código-base em várias destas áreas; isso não
transforma os critérios novos em entregas verificadas.

### Para o cliente — mensagem pronta

> 1. Precisamos de uma amostra anonimizada do extracto de comerciante do M-Pesa e da descrição
>    das colunas, incluindo referências, taxas, devoluções e data/hora de liquidação.
> 2. Precisamos de confirmar com a Vodacom como obter o extracto completo diariamente e quais
>    são os limites de consulta para as contas das cozinhas.

Sem alterar valores comerciais ou iniciar serviços a partir do documento da proposta.

### Para o Gabriel

| ID | Próxima acção | Como verificar |
|---|---|---|
| B-105 | Aplicar 1045 primeiro na BD de staging, testar SQL/RLS e só depois publicar frontend | Perfis e lojas isolados, página 13, filtros e POS com mais de 100 activos |
| B-106 | Configurar scheduler único, segredo e contas por loja | Seguir todos os cursores, medir timeouts e registar resultados no ambiente de ensaio |
| B-107 | Validar o contrato do extracto e implementar o adaptador | Amostra real anonimizada, nenhuma linha omitida, discrepâncias explicadas |

### Hardware e impacto na abertura

V1 não exigiu ensaio físico. A reserva de impressão de V4 continua a precisar de duas
impressoras, papel/rede e técnico local; reservar **2–4 horas como estimativa** para testar
falha e recuperação depois de implementar o mecanismo. Nenhum equipamento foi declarado validado.

| Impacto | Dependência | Sem isto… |
|---|---|---|
| 1 | B-105 | o painel novo não deve ser publicado contra a RPC antiga |
| 2 | B-106 | a reconciliação preparada não corre continuamente com as contas reais |
| 3 | B-107 | a conferência serve ficheiros normalizados; ainda não existe importação diária do extracto oficial |

---

---

## PACOTE FINAL — e-Mola directo · 2026-09-14

**2 bloqueios desta etapa continuam abertos: 1 infraestrutura/validação,
1 fornecedor/integração, 0 hardware.** A segunda passagem confirma que os
simuladores não substituem staging nem o contrato Movitel.

Preparado localmente: escolha directa por loja, telefone e-Mola separado do M-Pesa,
simulação de sucesso/recusa/pendência, confirmação pelo método gravado, consulta
noutro processo e reconciliação. Preservada a idempotência do checkout e a referência
da tentativa; falha definitiva passa pelo domínio. Não há cobrança real implementada
para Movitel, activação de conta ou publicação em produção.

Validação final do motor: **774 testes**, lint/typecheck e build completo passaram;
**15 testes de navegador** passaram com RPCs/pagamentos simulados. Foram também
ensaiados duplicados, anulações e respostas inválidas no confirmador comum.
SQL embebido: **16 casos da 1048 passaram**, incluindo reaplicação; relatórios
anteriores 1046/1047 permanecem disponíveis. pgTAP/RLS em staging por executar.

### Para o cliente — mensagem pronta

> 1. Precisamos do contacto comercial/técnico da Movitel para receber pagamentos
>    e-Mola directamente e identificar a conta de comerciante de cada loja.
> 2. Precisamos da documentação oficial de integração e do ambiente de ensaio,
>    com as condições comerciais e o procedimento de recuperação de pagamentos.

### Para o Gabriel

- Obter o pacote de integração directa Movitel e acesso de ensaio; não contratar Paysuite.
- Implementar o adaptador com os contratos recebidos, guardar segredos só no servidor
  e validar sucesso, recusa, timeout, repetição e confirmação tardia.
- Aplicar 1046/1047/1048 em staging antes do código, testar perfis/lojas e configurar
  o scheduler; remover a guarda real apenas com adaptador e validação concluídos.

### Hardware e impacto

Sem ensaio físico adicional: **0 horas de hardware nesta preparação**. O teste
real no telemóvel depende da conta e do ambiente de ensaio disponibilizados pela Movitel.

| Impacto | ID | Sem isto… |
|---|---|---|
| 1 | B-108 | o código novo não deve ser publicado contra uma BD sem migrations validadas |
| 2 | B-109 | e-Mola directo permanece em preparação; a loja pode receber comprovativos |

---

## PACOTE FINAL — Análise e Aquisição · 2026-09-24

Âmbito desta corrida: as duas vistas da aba Análise, não a execução das outras fases do produto.

- **Para o cliente:** nenhuma pergunta ou dado comercial em falta nesta etapa.
- **Para Gabriel:** B-111 — validar em staging e conferir o relatório/exportação com os dados reais. Nenhuma conta paga, credencial nova ou migration necessária para o redesenho.
- **Hardware:** nenhum bloqueio; 0 horas de validação física adicional.
- **Decisões:** base visual opt-in para migração posterior; falhas de marketing independentes de vendas; acesso de loja resolvido antes de consultar métricas. Registadas em `docs/desenvolvimento/analise-interface.md`.
- **Segunda passagem:** a correcção da loja de exportação ficou coberta pelo ensaio de gerente; B-111 continua aberto porque mocks não validam dados e sessões reais.
- **Bloqueios novos abertos por categoria:** cliente 0; infraestrutura/validação (Gabriel) 1; hardware 0.

| Impacto na abertura | ID | Sem isto… |
|---|---|---|
| Melhoria de gestão; não altera a venda no balcão | B-111 | a nova interface não está validada com os dados reais para promoção; o POS e o fluxo de venda mantêm-se |

Validação final desta etapa: `pnpm lint`, `pnpm test` (942), build de produção com configuração local e 8 testes Playwright passaram. Capturas revistas em `output/playwright/analysis-*.png`. Limites: dados simulados, auditoria automática restrita à nova área; B-111 não está fechado.

---

## PACOTE FINAL — correcção da exportação · 2026-09-24

- **Funciona em ensaio local:** download autenticado atravessando a rota da aplicação, CSV e resumo por pedido conferidos; testes de volume >1000 linhas e de erros sem ficheiro parcial. O primeiro teste reproduziu o 401 com Bearer válido antes da correcção.
- **Por validar:** B-111 mantém o ensaio de staging com sessões/dados reais. B-112 cobre a compatibilidade efectiva com o programa de facturação. Nenhuma promoção para produção nesta corrida.
- **Para o cliente/contabilista — mensagem pronta:** 1. Qual é o programa e a versão usados para emitir as facturas? 2. O fornecedor pode facultar o ficheiro-modelo de importação de vendas ou a documentação da API, incluindo artigos, impostos e referência do pedido?
- **Para Gabriel:** obter o contrato com o parceiro, confirmar os dados fiscais com o contabilista e implementar/ensaiar o adaptador. Eventuais licenças de integração são a confirmar com o fornecedor, sem subscrição feita nesta etapa.
- **Hardware:** 0 bloqueios, 0 horas de validação física.
- **Segunda passagem:** autenticação, paginação e totais resolvidos localmente; falta de contrato de importação não foi resolvida pelos testes e B-112 continua aberto.
- **Contagem desta continuação:** 1 bloqueio novo de fornecedor/integração; 1 pendência anterior de infraestrutura/validação (B-111); 0 de hardware.

| Impacto na abertura | ID | Sem isto… |
|---|---|---|
| Importação/facturação no destino | B-112 | não é possível garantir importação directa no WinREST nem emissão automática; continua disponível o CSV para conferência/mapeamento |
| Promoção da melhoria | B-111 | falta validar o fluxo com as sessões e os dados reais antes de publicar |

Verificação final desta continuação: 963 testes de domínio/integração local, 9 ensaios Playwright, lint/typecheck e build aprovados. Zero violações automáticas A/AA na área nova, incluindo os selectores de exportação. B-111 e B-112 permanecem abertos.

---

## PACOTE FINAL — origens e upsells · 2026-09-24

- Funcional: atribuição online/POS separada; upsells observados e ligados a itens confirmados, relatório por produto/oferta e margem bruta apenas com custo conhecido.
- Para o cliente: nenhuma decisão necessária para activar o rastreio. O histórico anterior não permite atribuir compras a ofertas com rigor.
- Para Gabriel: completar fichas técnicas/custos para os produtos com “Por apurar”; custos diferenciais de upgrades exigem modelo próprio antes de apresentar margem desses upgrades. A interface mantém receita disponível.
- Hardware: nenhum bloqueio novo; rastreio não muda o talão nem exige actualizar o bridge.
- Pendências anteriores preservadas: B-111 (ensaio humano com dono/gerente e dados reais) e B-112 (contrato de importação WinREST). Não são fechadas por testes simulados.
- Segunda passagem: trigger de produção corrigido para `main`; publicação de `dev` fica limitada ao staging. Não há novo bloqueio técnico nesta entrega; limitações de dados explicitadas em `docs/modulos/marketing.md`.
- Contagem desta entrega: cliente 0, acesso/infraestrutura 0, hardware 0; mantêm-se as duas pendências anteriores de validação/fornecedor.

Verificação adicional desta entrega: 973 testes unitários, 60 testes de base de dados e 12 Playwright aprovados, lint/typecheck e build aprovados. Leitura autenticada de staging com totais reconciliados. Segunda revisão preservou a origem online de pedidos via QR de mesa.

## PACOTE FINAL — agendamento dos relatórios · 2026-09-27

- **Funciona em staging:** deploy do resumo, migrations 1096/1101, ligação de Maputo
  na aba Lojas, CRON_SECRET/Vault e OWNER_EMAIL. Dois jobs activos: diário às 08h
  com o dia anterior de Maputo, mensal no dia 1 às 08h com o último mês fechado.
- **Verificado:** lint/typecheck e 1160 testes unitários na passagem final; build Railway; 401 sem
  segredo; HTTP autenticado de ambos os relatórios; RPC mensal exclusiva do servidor;
  ensaio da constraint SQL falhou antes da 1101 e passou depois, incluindo 10/256/512
  caracteres e rejeição de limites inválidos; guardar o perfil pela UI gerou sucesso.
- **Não verificado:** entrega de email (resultado real `skipped_no_key`), API Places,
  disparo natural do relógio e promoção a LIVE. A suite completa de integração de BD
  não foi executada contra staging, pois cria/apaga vendas de ensaio.
- **Cliente — mensagem pronta:** 1. A Matola já tem um perfil próprio no Google Maps?
  Se tiver, envie o link. Se não tiver, o resumo continua sem métricas Google dessa loja.
- **Gabriel:** configurar a caixa SMTP autorizada, sem colocar a senha no Git/chat;
  disponibilizar projecto Google com facturação/Places API (New) e chave restrita;
  completar B-022 antes da promoção. Desactivar os jobs de staging antes de activar LIVE.
- **Hardware:** nenhum requisito, 0 horas adicionais.
- **Decisões:** Supabase Cron existente, sem outro serviço contratado; HTTP síncrono
  isolado no cron, timeout 120s, falha visível quando email não foi enviado, sem retries
  automáticos. Nenhum segredo em comandos de jobs ou no repositório.
- **Segunda passagem:** scheduler, migration e Place ID de Maputo resolvidos;
  SMTP/Google/LIVE continuam dependentes de configuração externa. Matola é opcional.
- **Bloqueios desta entrega:** 2 IDs abertos de Gabriel/infraestrutura (B-114 e B-022),
  correspondentes a SMTP, Google e preparação LIVE; 0 de hardware e 0 impedimentos
  obrigatórios do cliente. GBP continua uma parcela anterior de B-114.

| Impacto | ID | Sem isto… |
|---|---|---|
| Ambiente que envia vendas reais | B-022 | os relatórios instalados mostram staging; não o negócio que ainda corre no 1.0 |
| Envio do relatório | B-114 — SMTP | nenhum email diário/mensal é enviado |
| Métricas Google | B-114 — Places | o relatório pode sair por SMTP, mas sem nota/avaliações |

## PACOTE FINAL — módulo de emails · 2026-09-28

- Implementado: editor por blocos, transaccionais por evento, promoções/funis por
  loja, sequência com intervalos, SMTP/Vault, consentimento e cancelamento, histórico.
- Validado: 1175 testes, lint/typecheck, build local; migration 1104 em staging e SQL
  com rollback (não cria pedidos nem envia): isolamento, permissões, duplicação,
  claim exclusivo, pausa, intervalo desde envio real, cancelamento.
- Publicado e verificado em staging (`11022d9e-76d7-4099-af4a-aeb4e6ee3dd9`):
  editor, gravação/reabertura de duas etapas, preview móvel e configuração.
  `app-emails` activo, execução natural `succeeded` às 00h17 de Maputo de 28/09.
  HTTP 401 sem sessão/segredo. Nenhum email enviado; funil de boas-vindas em rascunho.
- Corrigidos `APP_BASE_URL` e `NEXT_PUBLIC_APP_BASE_URL` do Railway para o domínio
  real `https://hawsmash2-staging.up.railway.app`; antes apontavam para domínio retirado.
- Revisão final: pausa das sequências também impede o transporte antigo de enviar;
  regressão reproduzida antes da correcção, total final de 1176 testes unitários.
- Para o cliente: nenhuma decisão pendente para usar o editor. Registar a origem do
  consentimento dos contactos que vão receber promoções.
- Para Gabriel: B-114 — inserir a credencial da caixa SMTP autorizada no painel,
  testar a ligação e depois validar uma recepção autorizada. B-022 — preparar LIVE
  antes de promover; jobs de staging não devem coexistir a enviar para clientes LIVE.
- Hardware: nenhum requisito adicional.
- Segunda passagem: publicação e scheduler desbloqueados; credenciais SMTP/recepção
  real e preparação LIVE continuam pendentes, sem nova dependência de hardware.
- Decisões: apenas owner gere emails; fila congela versões; SMTP sem retry automático
  para não duplicar mensagens após falha de rede; relatórios/OTP conservam conteúdo
  operacional. Ver `docs/modulos/emails.md`.
- Bloqueios desta entrega: 2 IDs anteriores de acesso/infraestrutura (B-114, B-022),
  0 novos do cliente, 0 de hardware.

| Impacto | Quem / ID | Sem isto… |
|---|---|---|
| Enviar mensagens | Gabriel — B-114 / SMTP | editor e fila funcionam, mas nenhum email sai |
| Operação LIVE | Gabriel — B-022 | módulo fica validado em staging, sem alterar o 1.0 |

## PACOTE FINAL — emails existentes, modelos e IA · 2026-09-28

- Implementado: nove emissores ligados às configurações do admin; modelo original
  ou blocos personalizados com dados preservados; 12 modelos; gerador gratuito
  WebLLM/Qwen local com conhecimento editorial e notas por loja; histórico operacional.
- Verificado: migration 1105 em staging, SQL em rollback, 1189 testes, lint/typecheck
  e build local. Deploy `7405b752-a401-4c6a-9a8d-c27ec2322afa` com sucesso; catálogo
  dos nove emissores, escolha entre 12 modelos, gravação e reabertura no navegador.
  Modelo original reposto após o ensaio. IA WebGPU gerou três emails reais e abriu
  o editor com esperas 0/1440/2880 minutos, como rascunho manual. Nenhum envio.
- Segunda revisão: contexto inclui até 30 produtos disponíveis do menu da loja,
  sem preços/dados de pagamento; correcção de acentos, contraste do modelo antigo
  e editor operacional sem controlos de espera que não se aplicam.
- Revisão do gerador: exemplos de copy para clientes e instruções de tom pt-PT;
  emails globais assinados pela marca em vez de uma loja. 1190 testes aprovados.
- Validação final: deploy `d29ccad1-a909-4ef0-978b-bb2d34f87329` (91c7eea) com
  sucesso. Segunda geração real reutilizou o modelo em cache. Notas da marca
  guardadas e reabertas; contexto mostrou 25 produtos. Funil «Convite para voltar
  — rascunho IA» guardado com três etapas; última mensagem revista para retirar
  repetição e melhorar a escrita. Esperas 0/2880/10080 minutos; continua rascunho,
  sem contactos inscritos ou envios. A IA local produz rascunhos sujeitos a revisão.
- Cliente: nenhuma decisão necessária para editar. Confirmar os factos/oferta antes
  de activar uma campanha gerada. Nenhum contacto inscrito automaticamente.
- Gabriel: B-114 (SMTP/recepção e Places) e B-022 (LIVE) mantêm-se; não foi obtida
  uma palavra-passe SMTP nem activada facturação Google nesta entrega.
- Hardware: a IA local requer navegador WebGPU e memória gráfica; edição e modelos
  funcionam sem GPU. Não afecta vendas nem impressão.
- Decisões: IA no computador evita chave/custo por geração; emails operacionais
  preservam um bloco de dados e saem no evento, esperas nas sequências. Globais
  partilham configuração, sem duplicar configurações contraditórias entre lojas.
- Segunda passagem: scheduler e ligação dos emissores resolvidos em staging;
  permanecem 2 IDs de acesso/infraestrutura, 0 novos do cliente e 0 de hardware
  obrigatório para abertura. Envio real continua por validar.

| Impacto | Quem / ID | Sem isto… |
|---|---|---|
| Enviar emails | Gabriel — B-114 / SMTP | o editor funciona, mas a caixa não está autenticada |
| Operação LIVE | Gabriel — B-022 | mudanças continuam em staging, sem alterar o 1.0 |
