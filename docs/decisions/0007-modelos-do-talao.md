# ADR 0007 — Modelos do talão como dado, aplicados pelo print-bridge

Data: 2026-09-23. Estado: aceite.

## Contexto

O desenho do talão (que blocos aparecem, por que ordem, em que tamanho) estava escrito no
`escpos.ts` do print-bridge, o programa que corre no mini-PC de cada loja. Mudar uma linha do papel
obrigava a gerar um `.exe` novo e a trocá-lo à mão em cada loja — trabalho de suporte caro, fora de
horas, e o motivo por que "a comanda é configurada no mini-PC".

O dono quer escolher como o papel sai: um modelo por via (a via do cliente vai no saco; a via da
cozinha só precisa do que se cozinha), menos papel quando quiser, e o número de vias.

## Decisão

- **Modelos prontos, não um editor livre.** Três modelos para o talão completo — **Completo** (o de
  sempre), **Compacto** (o dinheiro, com menos papel), **Cozinha** (sem preços, artigos a dobrar) — e
  interruptores para os blocos do Completo (logo, morada, agradecimento, QR, rodapé, letra dos
  artigos). Num papel de 80 mm, um modelo mal desenhado faz a comanda sair ilegível ou não sair, e a
  cozinha a imprimir é não-negociável (CLAUDE §0). Modelos novos entram por código e testes.
- **O layout é dado da loja:** `store_pos_settings.config.printing` (1067), editado na aba POS e lido
  com `resolvePrintLayout` — uma chave estragada cai no de fábrica, campo a campo. O número de vias
  continua em `stores.kitchen_ticket_copies`, agora editável pela RPC `set_store_ticket_copies` (1071).
- **Quem aplica é o print-bridge**, que lê o layout ao arrancar e de minuto a minuto e guarda cópia em
  disco (`data/print-layout.json`). Não se mexe nas RPCs que criam a venda e os trabalhos de impressão:
  um erro no layout nunca pode reverter uma venda (Regra 1), e o caminho offline (POS → bridge na
  rede local) também fica coberto. Troca-se o `.exe` **uma última vez**; depois, tudo pelo painel.
- **Os formatos saem do bridge para `packages/receipt`** (`@delivery/receipt`): descrevem o papel como
  instruções neutras (texto, negrito, tamanho, QR, logo, corte). O bridge converte-as em ESC/POS; o
  painel converte as mesmas em linhas de ecrã. A pré-visualização é o que a impressora faz.
- **O de fábrica é o papel de antes, byte a byte.** Gravado antes da mudança em
  `services/print-bridge/src/__tests__/talao-bytes.test.ts` (9 formatos); qualquer diferença falha o CI.

## Alternativas rejeitadas

- **Editor livre de modelos** (blocos arrastáveis, texto com marcação): risco de papel ilegível na
  cozinha; o suporte passava a depurar talões desenhados por terceiros.
- **Juntar o layout ao payload na base de dados** (trigger em `print_jobs`): tocava o caminho
  transaccional da venda — um erro ali reverte a venda — e não cobria a impressão offline.
- **Pré-visualização por uma rota do servidor a importar o bridge:** mistura um serviço de Node no
  bundle da app; com o pacote partilhado a pré-visualização corre no browser, ao vivo.

## Consequências verificáveis

- `talao-bytes.test.ts`: com o layout de fábrica, 9 formatos com os mesmos bytes de antes.
- `packages/receipt/src/__tests__/layout.test.ts`: Cozinha sem preços nem pagamento; Compacto sem
  logo nem QR; cada interruptor tira só o seu bloco; lixo cai no de fábrica.
- `services/print-bridge/src/__tests__/print-layout.test.ts`: aplica o que vem do painel, guarda e
  recupera a cópia sem rede, mantém o que estava quando a leitura falha.
- `packages/db/tests/pos-settings.test.ts`: vias só pelo dono e pelo gerente da loja, 1–3, registadas.
- Um bridge com o programa antigo ignora o layout e continua a imprimir o Completo: dá para actualizar
  loja a loja.
