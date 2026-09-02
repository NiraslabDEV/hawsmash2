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
- Nota da F10: as chaves do Paysuite **não** são editáveis nem legíveis no painel (são segredo; o grant por
  coluna tira-as do alcance do browser). Entram por migration ou pelo Supabase, nunca pelo ecrã.
- Se a resposta for outra: zero reescrita — é preencher dados.

### B-002 · [F7] Zonas e taxas de entrega da Matola
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: que zonas entrega a Matola e a que preço cada uma?
- Como avancei: seed da Matola com **uma zona `PLACEHOLDER_ZONA` a 150 MT** e a loja com `delivery_enabled`
  (a taxa é a mesma que o 1.0 cobra em Maputo). Maputo mantém a zona real do 1.0.
  `scripts/check-placeholders.mjs` **falha o go-live** enquanto esta zona existir com este nome.
- Onde está: `supabase/seed.sql` · marcador `BLOQUEIO: B-002` · guarda em `scripts/check-placeholders.mjs`
- Se a resposta for outra: **minutos, pelo painel** — aba Lojas → Matola → zonas de entrega (F10). Já não
  precisa de ninguém a mexer na base de dados.

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
- Como avancei: a aba **Equipa** já cria contas, atribui perfil/lojas e define PIN (`/equipa`), e a remoção
  de acesso é imediata. Falta só **quem** são as pessoas — nenhuma conta real foi criada.
- Onde está: `apps/web/app/(admin)/equipa/page.tsx` · RPC `set_staff_access` / `deactivate_staff`
- Se a resposta for outra: minutos — criar contas no ecrã de Equipa.

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

### B-006 · [F3] Hardware físico para validação
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
  - Plano B inalterado: a gaveta liga à `XP-T80Q` do balcão, como `docs/HARDWARE.md §2` sempre previu.
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
    o `PRINTER_IP_*`/TCP do `docs/HARDWARE.md` é só o caminho alternativo, para impressora de rede.
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
- Como avancei: as duas rotas existem e funcionam em qualquer browser sem sessão —
  `/tv/[store]/menu` (cardápio com esgotados) e `/tv/[store]/senhas` (número do dia). Ambas recarregam
  sozinhas e mantêm o último estado se a rede oscilar.
- Onde está: `apps/web/app/(tv)/` · RPC `get_store_board` e `get_store_queue`
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

### B-015 · [F7] Morada e contacto de cada loja
- Estado: aberto
- Desbloqueia: cliente
- Pergunta exacta: qual a morada exacta (e telefone) de cada loja — Maputo e Matola — para aparecer no site?
- Como avancei: `stores.address`, `stores.phone` e `stores.maps_url` estão vazios; o ecrã de escolha mostra
  "Morada por confirmar" e o rodapé simplesmente omite a linha em falta — nada quebra, mas o cliente não
  sabe onde levantar. A pele nova do site (portada do 1.0) tornou isto visível em dois sítios.
- Onde está: `apps/web/app/(public)/page.tsx` · `_hawsmash/sections.tsx` (rodapé) · dados em `stores`
- Se a resposta for outra: minutos, pelo painel — aba **Lojas** → morada, telefone e link do mapa.


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
- Onde está: `services/print-bridge/src/customer-display.ts` · `.env.example` · `docs/HARDWARE.md §1.2`
- Se a resposta for outra: **zero reescrita** — são três linhas de `.env`. O único caso que obriga a
  código é o mostrador falar um terceiro protocolo (nem CD5220 nem DM-D); aí é meia hora, com o
  manual do modelo à frente.
- Nota: a escrita na porta série é feita com `mode.com` + `\\.\COMx` e **não** com o módulo
  `serialport`, de propósito — um binding nativo partiria o empacotamento `.exe` (SEA) do bridge que
  já corre nas lojas.

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

### B-022 · [F0] O ambiente `production` do Railway está vazio e segue o ramo `dev`

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

## RESOLVIDOS

*(mover para aqui, com data, sem apagar o histórico)*

---

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
| B-006 | Impressão real nas duas cozinhas, **gaveta a abrir**, POS em kiosk no PC touch, watchdog do bridge no Windows | 1–2 h por loja (10 testes de `docs/HARDWARE.md §4`) |
| B-006 | **Ensaio geral** por loja: 20 vendas, 5 delivery, falha de rede, falha de impressora, fecho de caixa | ~90 min por loja (guião em `docs/RUNBOOK.md §6`) |
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
