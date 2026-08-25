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
- Estado: **aberto — descoberto em 2026-08-23**
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

### B-017 · [F6] Stock dos combos vendidos como produto único
- Estado: **aberto — decisão consciente, não é bug**
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

### B-018 · [F3] Visor do cliente: porta, velocidade e protocolo
- Estado: aberto
- Desbloqueia: hardware (5 minutos em cada loja, com o PC ligado)
- Pergunta exacta: em que **porta COM** está o mostrador de cada PC touch, a que **velocidade**, e
  fala **CD5220** ou **Epson DM-D (ESC/POS)**?
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
