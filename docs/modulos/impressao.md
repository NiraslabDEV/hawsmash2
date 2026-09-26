# Impressão, gaveta e visor do cliente

Cada loja tem um print-bridge no PC local. O serviço recebe trabalhos da BD e pedidos HTTP da LAN, converte instruções em ESC/POS e envia-os à impressora; a gaveta recebe um pulso através da impressora. O painel continua a mostrar a venda quando o papel falha. Esta descrição é de código; papel legível, corte, gaveta, porta série e arranque Windows exigem equipamento real.

## Componentes e fluxo

| Componente | Responsabilidade |
|---|---|
| `print_jobs` | Fila por loja, pedido, estação, tipo e sequência de reimpressão |
| [repository.ts](../../services/print-bridge/src/repository.ts) | Lê colunas explícitas e lotes de 10 `queued` da loja; reclama o trabalho comparando ainda `queued` |
| [polling.ts](../../services/print-bridge/src/polling.ts) | Poll default de 3 s; despacha e marca `printed`/`failed` |
| [printer-target.ts](../../services/print-bridge/src/printer-target.ts) | Destinos TCP, fila Windows ou porta série |
| [printer-client.ts](../../services/print-bridge/src/printer-client.ts) | Envio com três tentativas; esperas de 1 e 2 s por omissão |
| [operations.ts](../../services/print-bridge/src/operations.ts) | Heartbeat e recuperação de jobs presos, a cada 60 s |
| [`@delivery/receipt`](../../packages/receipt/src/index.ts) | Tipos, instruções, formatos, layout, encoder e pré-visualização partilhados |
| [escpos.ts](../../services/print-bridge/src/escpos.ts) | Adaptador do bridge: layout actual, logo e marca da instalação |

`bridge_heartbeat` actualiza o dispositivo; `recover_stale_print_jobs` recupera trabalhos presos segundo o contrato da BD. Não se deve confundir o contador de reclamações do job com as tentativas de transporte da impressora. O README anterior dizia esperas 1/3/9 s; o código auditado usa 1/2 s entre três tentativas.

Trabalhos usam `order`, `receipt`, `drawer`, `cash_close` e `test`; o payload pode seleccionar formatos como senha. `reprint` cria outra sequência, marcada como reimpressão e auditada. As decisões de vias/estação são feitas na BD; o bridge encaminha o job recebido.

## Modelos e vias da loja

O papel de referência é 80 mm, 48 colunas e CP1252. A quantidade de vias vive em `stores.kitchen_ticket_copies`, 1–3, alterada por `set_store_ticket_copies`. Com duas vias, controlo sai no balcão e cliente na cozinha; a terceira acrescenta cozinha. A via única e a reimpressão usam o modelo da via de controlo.

| Modelo | Conteúdo |
|---|---|
| Completo | Logo/contactos, senha, cliente/canal/horário, artigos/preços/notas, totais, pagamentos/troco, agradecimento, QR e rodapé |
| Compacto | Identificação, artigos/preços, totais/pagamento e rodapé; sem logo/contactos/agradecimento/QR |
| Cozinha | Artigos e notas destacados, cliente/canal/horário/entrega; sem preços nem pagamento |

`store_pos_settings.config.printing` guarda modelos por via e interruptores do Completo: logo, contactos, agradecimento, QR, rodapé e tamanho dos artigos. Só afecta o talão completo. O fecho de caixa, a gaveta e os formatos curtos/legados têm contratos próprios. Mesas imprimem comanda em vias e senha pequena desde a 1092; a conta liquidada usa talão completo, conforme [Mesas](mesas.md). O offline do POS conserva o formato curto local.

O bridge lê o layout à entrada e a cada 60 s, guarda-o em `PRINT_LAYOUT_FILE` e recupera-o ao reiniciar sem rede. Falha de leitura mantém o último layout; sem cópia, usa fábrica. O painel aplica `buildFullTicket` + `renderPreview`; o bridge aplica as mesmas instruções + `encodeEscPos`. A pré-visualização não substitui medir margens/fonte no equipamento.

## API local, permissões e idempotência

[local-server.ts](../../services/print-bridge/src/local-server.ts) expõe:

| Endpoint | Pedido/resultado |
|---|---|
| `GET /health` | Loja, uptime e presença do visor |
| `POST /print` | `requestId`, estação, tipo e payload |
| `POST /drawer` | `requestId`; envia `1B 70 00 19 FA` |
| `POST /display` | Modo `idle` ou texto em duas linhas; visor opcional |

Exige Bearer `LOCAL_TOKEN`; origens do browser devem constar de `LOCAL_ALLOWED_ORIGINS`. Pedidos sem `Origin` continuam suportados. O corpo tem limite de 1 MiB. O visor sem configuração devolve resultado sem travar o POS; não tem ledger porque alterar texto não cria papel nem dinheiro.

Print/gaveta usam um mapa de pedidos em curso e um [ledger persistente](../../services/print-bridge/src/request-ledger.ts) de IDs concluídos. Essa protecção cobre retries normais e reinícios **depois** da gravação. Não garante exactamente uma impressão num crash entre envio físico e gravação do ledger, nem entre envio e confirmação `printed` na BD. TCP aceite também não prova que havia papel. Não voltar a cobrar por uma falha ou duplicação de talão.

A API local autentica o terminal por token; não valida por si só a sessão/PIN de cada operador. A regra de perfil e auditoria para abrir gaveta fora de venda deve ser preservada no fluxo POS/RPC. O exemplo de `curl /drawer` é uma chamada técnica, não autorização de operador.

## Configuração e arranque

Usar o [exemplo específico do bridge](../../services/print-bridge/.env.example). São necessários Supabase, `STORE_ID`, `BRIDGE_DEVICE_ID`, token e origens; a raiz tem apenas um subconjunto. `PRINTER_KITCHEN`/`PRINTER_COUNTER` aceitam `tcp://`, `windows://` ou `serial://`; os antigos `PRINTER_IP_*` continuam TCP. `LOCAL_HTTP_HOST` e `PRINT_LAYOUT_FILE` são suportados pelo código mas faltam nos dois exemplos auditados. Segredos ficam no mini-PC protegido, nunca no bundle público.

O [entrypoint](../../services/print-bridge/src/index.ts) procura `.env` junto do executável, depois no directório de trabalho. O [empacotamento SEA](../../services/print-bridge/windows/build-sea.ps1) produz o `.exe`; [install-task.ps1](../../services/print-bridge/windows/install-task.ps1) instala tarefa `SYSTEM`, ao arrancar Windows, com reinício após falha. Os nomes de executável/tarefa ainda contêm identidade desta instalação: é uma dívida de portabilidade, não uma exigência para outra marca.

`pnpm --filter print-bridge dev:sim` executa a demo independente do simulador. `dev` inicia o serviço completo, mesmo que a impressora seja simulada; precisa de configuração e fala com a BD configurada. O `bridge:dev` da raiz contém atribuições POSIX incompatíveis com o shell Windows padrão. Não o apresentar como ensaio isolado sem credenciais.

Para actualizar modelos: transportar pacote/adapter/sync, conservar configuração e logo da instalação, gerar o executável, substituir fora do horário e imprimir cada modelo. Para adicionar modelo: alterar `TicketTemplate`/`TICKET_TEMPLATES`/resolver, formatador e testes; validar em papel antes de o oferecer. Um bridge antigo ignora layouts novos e conserva o Completo; uma senha nova pode cair no formato legado maior.

## Dados, eventos, testes e pendências

Dependências: `stores`, `store_pos_settings`, `print_jobs`, `devices`, `orders`, `event_log`; RPCs `reprint`, `set_store_ticket_copies`, `bridge_heartbeat`, `recover_stale_print_jobs`. Eventos incluem `print_job_printed`, `print_job_failed`, `store.ticket_copies_changed`, `store.pos_settings_changed` e eventos próprios de mesas/alteração. Eventos do serviço podem ter autor humano nulo.

Há 18 ficheiros de teste no [bridge](../../services/print-bridge/src/__tests__) e quatro no [receipt](../../packages/receipt/src/__tests__). [talao-bytes.test.ts](../../services/print-bridge/src/__tests__/talao-bytes.test.ts) conserva snapshots de nove formatos de fábrica; o logo da instalação pode alterar bytes, pelo que o ensaio deve controlar essa entrada. Layout/sync, ledger, routing, HTTP, TCP simulado, gaveta, visor e empacotamento têm testes específicos. Testes SQL: [print](../../packages/db/tests/print.test.ts), [comanda-padrao](../../packages/db/tests/comanda-padrao.test.ts), [pos-settings](../../packages/db/tests/pos-settings.test.ts), [mesas](../../packages/db/tests/mesas.test.ts). Os resultados da suite unitária estão na [validação documental](../validation/revisao-documental-2026-09-26.md); não se executou SQL nem ensaio físico.

[ADR 0007](../decisions/0007-modelos-do-talao.md) define modelos como dados; [ADR 0006](../decisions/0006-definicoes-do-pos-por-loja.md) define a configuração por loja. Consultar B-005, B-006 e B-018 em [BLOQUEIOS](../../BLOQUEIOS.md) para conteúdo do talão e validação física. As discrepâncias estão registadas na [auditoria](../AUDITORIA-DOCUMENTACAO.md).


## Integração e portabilidade — detalhes

Conteúdo consolidado do guia anterior de definições do POS. Os ensaios relatados são históricos; não foram repetidos em hardware nesta revisão.

## 11. Impressão (talão)

Decisão: [ADR 0007](../decisions/0007-modelos-do-talao.md). Contrato: `packages/receipt`.

### 11.1 O que se escolhe

| | Onde vive | Quem aplica |
|---|---|---|
| **Vias por pedido** (1, 2 ou 3) | `stores.kitchen_ticket_copies` — RPC `set_store_ticket_copies` (1071) | A base de dados, ao criar os trabalhos de impressão |
| **Modelo de cada via** e **blocos do Completo** | `store_pos_settings.config.printing` | O print-bridge, ao montar o papel |

| Modelo | Leva | Para quê |
|---|---|---|
| **Completo** | Tudo, como sempre: logo, morada, senha, cliente, tipo, horário, artigos com preço, nota, totais, pagamento, agradecimento, QR, rodapé | O papel da casa (valor de fábrica) |
| **Compacto** | Senha, cliente, tipo, horário, artigos com preço em letra normal, totais, pagamento, rodapé. Sem logo, morada, agradecimento nem QR | Menos papel, o dinheiro todo |
| **Cozinha** | Senha, cliente, tipo, entrega, horário, artigos e notas a dobrar, nota do pedido. **Sem preços nem pagamento** | A via que fica na cozinha |

- Com **1 via**, sai um talão sem rótulo; com **2**, controlo (balcão) + cliente (cozinha); com **3**,
  mais a via da cozinha. A via única e a **reimpressão** usam o modelo da via de controlo.
- Os interruptores (logo, morada e telefone, agradecimento, QR, rodapé, artigos em letra alta) afinam
  **só o Completo**. O Compacto e o Cozinha são fixos — é o que os mantém testados.
- **Não mudam:** a comanda curta e o talão curto (mesa e POS sem rede), o fecho de caixa e a gaveta.

### 11.2 Como chega ao papel

```
Aba POS ──save_pos_settings──▶ store_pos_settings.config.printing
                                            │
print-bridge (mini-PC) ◀── lê ao arrancar e a cada 60 s ──┘
     ├─ guarda cópia em data/print-layout.json (sem rede, e depois de reiniciar sem rede)
     └─ buildFullTicket(payload, layout) → encodeEscPos → impressora
Painel: buildFullTicket(exemplo, layout) → renderPreview → o talão desenhado no ecrã
```

O mesmo código (`buildFullTicket`) desenha o papel e a pré-visualização: o que o dono vê é o que sai.
Um erro a ler o layout nunca pára a impressão — fica o que estava; sem nada, o de fábrica.

### 11.3 A garantia do papel de sempre

`services/print-bridge/src/__tests__/talao-bytes.test.ts` guarda os **bytes** de 9 formatos, gravados
antes de os modelos existirem. Com o layout de fábrica têm de sair iguais — no CI e em qualquer cópia
deste módulo. Se um mudar de propósito, actualiza-se o retrato **e** imprime-se em papel.

### 11.4 Acrescentar um modelo novo

1. `packages/receipt/src/layout.ts`: o nome em `TicketTemplate`, a descrição em `TICKET_TEMPLATES` e o
   valor aceite em `resolvePrintLayout`.
2. `packages/receipt/src/tickets.ts`: o que leva, em `optionsFor` (ou um ramo próprio em `buildFullTicket`).
3. Testes em `packages/receipt/src/__tests__/layout.test.ts` — o que sai e o que **não** sai.
4. Imprimir em papel antes de o oferecer às lojas. O painel mostra-o sozinho (lê `TICKET_TEMPLATES`).

### 11.5 Levar o mini-PC para esta versão

1. No repositório: `BRAND_LOGO_FILE=/nao/existe.b64 npx vitest run services/print-bridge` verde
   (o logo local muda os bytes; o CI não o tem).
2. Gerar o `.exe` (`services/print-bridge/README.md`) e trocá-lo **fora do horário** (Qui–Sáb as lojas
   estão abertas), como em `docs/historico/instalacao-pos-2026-09-23.md`. O `.env` e o `brand-logo.b64` ficam.
3. No arranque, o log mostra a leitura do layout; `data/print-layout.json` aparece ao lado do `.env`.
4. Imprimir um pedido de teste e comparar com a pré-visualização da aba POS.

Um mini-PC que ainda não foi actualizado ignora o layout e imprime o Completo — dá para actualizar
loja a loja, sem pressa de fazer as duas no mesmo dia.


---

## Contrato preservado da spec

A bridge também suporta fila USB Windows. A service key é ampla; `STORE_ID` filtra a aplicação, não restringe a chave por RLS. O comando PowerShell portável é `pnpm --filter print-bridge dev:sim`; `pnpm bridge:dev` abaixo usa sintaxe POSIX. Ficheiros de dados citados são gerados na instalação.

## 8. IMPRESSÃO E GAVETA

### 8.1 `print_jobs` (motor herdado, estendido)
```sql
print_jobs (id, store_id, order_id null, station text, kind text, reprint_seq int default 0,
            payload jsonb, status text, attempts int, created_at, printed_at,
            unique (order_id, station, kind, reprint_seq))
-- kind: 'order' (comanda cozinha) | 'receipt' (talão cliente) | 'drawer' | 'cash_close' | 'test'
-- station: 'kitchen' | 'counter' | 'bar' (herdado; HAWSMASH usa kitchen + counter)
```

### 8.2 print-bridge (um por loja)
- `.env`: `SUPABASE_URL`, service key **restrita**, `STORE_ID`, `PRINTER_IP_KITCHEN`, `PRINTER_IP_COUNTER`,
  `LOCAL_HTTP_PORT=7777`, `LOCAL_TOKEN`.
- **Poll** (3 s) de `print_jobs` da **sua loja** → ESC/POS → TCP 9100 → `printed`. Retry 3× com backoff →
  `failed` + `event_log` + **alerta**.
- **Servidor HTTP local (novo):** `POST /print`, `POST /drawer`, `GET /health` na LAN, autenticado por
  `LOCAL_TOKEN`. É por aqui que o **POS imprime e abre a gaveta sem internet**.
- **Gaveta:** pulso ESC/POS `ESC p 0 25 250` (`1B 70 00 19 FA`) para a impressora do balcão (a gaveta liga-se à
  impressora por RJ11 — ver [`docs/operacao/hardware.md`](../operacao/hardware.md)). Abrir gaveta **fora de venda** exige perfil
  e fica logado.
- **Watchdog:** arranque automático com o Windows, reinício em caso de crash, `heartbeat` a cada 60 s para
  `devices`. Empacotamento `.exe` (SEA) reaproveitado do HAWSMASH 1.0 (`docs/legacy/hawsmash-print-bridge/`).
- **Simulador** (`pnpm bridge:dev`) para desenvolver sem hardware.

### 8.3 Talão (80 mm · 48 colunas · CP1252)
**Um só papel para todos os pedidos — o talão completo, em vias** (decisão do dono, 23 Set; 1064):
balcão, levantamento ou entrega saem sempre em **dois talões completos**, o do HAWSMASH 1.0 — logo, loja,
senha, cliente (se tiver nome), BALCÃO/ENTREGA/LEVANTAMENTO, **HORÁRIO a dobrar**, itens em altura dupla com
preço, nota, totais, **TOTAL** grande, pagamento (misto, recebido e **troco** no balcão, §7.3), `[ PAGO VIA … ]`
e rodapé com QR (avaliação no Google, ou Instagram).
- **VIA DE CONTROLO** sai na impressora do balcão e fica na loja.
- **VIA DO CLIENTE** sai na da cozinha e depois cola-se no saco que vai para o cliente.
- **Reimprimir** sai **um** talão completo marcado **REIMPRESSÃO** — nunca passa por original (§7.4).
- O número de vias é da loja (`stores.kitchen_ticket_copies`, 2 por defeito), não do código — muda-se na
  aba **POS** (1071).
- **O modelo de cada via é da loja** (aba POS, `store_pos_settings.config.printing`): **Completo** (o de
  sempre, com interruptores para logo, morada, agradecimento, QR, rodapé e letra dos artigos), **Compacto**
  (o dinheiro, com menos papel) ou **Cozinha** (sem preços, artigos a dobrar). Modelos prontos e testados em
  `@delivery/receipt` — **nunca** um editor livre. O print-bridge lê o layout de minuto a minuto e guarda
  cópia em disco (`data/print-layout.json`); o de fábrica sai **byte a byte** igual ao de antes
  (`talao-bytes.test.ts`). A pré-visualização do painel usa as mesmas instruções que a impressora.
  ADR 0007.
A comanda curta e o talão curto do cliente ficam só para mesas (`dine_in`) e para o POS sem rede, que ainda
imprime localmente no formato antigo.
Formato de referência: `docs/legacy/HAWSMASH-1.0-CLAUDE.md §12.2` e `docs/legacy/hawsmash-print-bridge`
(já validados em papel). Morada, telefone, Instagram e link de avaliação vêm da base de dados, nunca do código.

**Regra herdada e inegociável:** falha de impressão **nunca** esconde nem bloqueia o pedido. O painel é o canal
primário; o papel é redundância.
