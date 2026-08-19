# HAWSMASH · Print-Bridge 🖨️

Serviço local que **imprime o cupom de cozinha automaticamente** quando um pedido
é aprovado. Corre num PC do restaurante (24/7), **separado do site** — não vai ao
Railway. O Ridwan aprova de qualquer lado (link do email ou painel admin) e o
papel sai sozinho na cozinha.

## Como funciona

1. De 3 em 3s, o bridge pergunta ao Supabase: *há pedidos `status='paid'` ainda
   não impressos (`printed_at IS NULL`)?*
2. Para cada um: monta o cupom **ESC/POS** (80mm) e envia por **TCP** para a
   impressora (`PRINTER_IP:9100`).
3. Se imprimiu, marca `printed_at` → nunca re-imprime.
4. Se a impressora estiver desligada/sem papel, **não marca** → tenta outra vez
   no ciclo seguinte (auto-recupera). **A impressão é redundância: nunca esconde
   nem bloqueia o pedido no painel.**

## Impressora — Xprinter XP-T80Q (80mm, Ethernet, ESC/POS)

### 1. Ligar à rede
Liga um **cabo de rede (RJ45)** da porta Ethernet da impressora (traseira, à
direita, com LEDs) ao **router/switch** do restaurante. Na cozinha, podes levar
um cabo do router ou pôr um switch lá. Liga o botão **ON**.

### 2. Descobrir/definir o IP
- **Self-test:** com a impressora desligada, mantém **FEED** premido e liga o
  botão ON. Ela imprime uma folha de teste com a config de rede — incluindo o
  **IP** (default de fábrica costuma ser `192.168.123.100`).
- **IP fixo (recomendado):** instala o utilitário **"Xprinter"/"Printer Set
  Tool"** (Windows, do CD/site Xprinter), liga por USB ou rede e define um IP
  fixo dentro da gama do router (ex.: `192.168.1.50`). Sem IP fixo, o router pode
  trocar o IP e o bridge deixa de encontrar a impressora.
- **Confirmar:** no PC, `ping 192.168.x.x` tem de responder.

> Porta ESC/POS = **9100** (não mexer).

## Instalar o bridge no PC

Pré-requisitos: **Node 18+** (https://nodejs.org), e o PC na **mesma rede** da
impressora, **ligado** enquanto a HAWSMASH recebe pedidos.

```bash
# 1. Copia a pasta print-bridge/ para o PC
cd print-bridge
npm install

# 2. Configura
copy .env.example .env        # (Windows)   |   cp .env.example .env (Mac/Linux)
#   edita o .env e preenche:
#     SUPABASE_SERVICE_ROLE_KEY  (ver abaixo)
#     PRINTER_IP                 (o IP da impressora)

# 3. Arranca
npm start
```

### Service Role Key (segredo)
Painel Supabase → projecto **hawsmash** → *Project Settings* → *API* →
**`service_role` secret** → copia para `SUPABASE_SERVICE_ROLE_KEY` no `.env`.
⚠️ Esta chave dá acesso total — vive **só neste PC**, **nunca** no site nem no Git
(o `.gitignore` já protege o `.env`).

## Testar SEM impressora (simulador)

```bash
npm run demo
```
Mostra 2 cupons de exemplo (entrega + levantamento) na consola — valida o formato
sem hardware. Para correr o serviço real contra a impressora virtual, põe
`USE_SIMULATOR=true` no `.env` e `npm start`.

## Testar a impressão real (ponta-a-ponta)

1. `.env` com `USE_SIMULATOR` apagado/false, `PRINTER_IP` certo, service key.
2. `npm start` → deve dizer `Modo PRODUÇÃO — impressora em <ip>:9100`.
3. Faz um pedido de teste no site e **aprova-o** (link do email ou admin).
4. Em ≤3s sai o talão na cozinha. 🎉

## Arrancar sozinho quando o PC liga (Windows)

Opção simples — **Agendador de Tarefas**:
1. Abre *Agendador de Tarefas* → *Criar Tarefa*.
2. Disparador: *Ao iniciar o computador* (ou *Ao iniciar sessão*).
3. Acção: *Iniciar programa* → escolhe o **`start.bat`** desta pasta.
4. Marca *Executar quer o utilizador tenha sessão iniciada ou não*.

(Alternativa: pôr um atalho do `start.bat` na pasta *Arranque* do Windows.)

## Resolução de problemas

| Sintoma | Verificar |
|---|---|
| Não imprime nada | `ping` ao IP responde? Cabo de rede? Botão ON? LED **PAPER** (sem papel)? |
| `timeout`/`ECONNREFUSED` no log | IP errado ou impressora noutra rede; porta tem de ser 9100 |
| Acentos estranhos (Ã, Â…) | A impressora não está em CP1252 — raro; abrir issue |
| Texto cortado nas margens | Ajusta `RECEIPT_WIDTH` no `.env` (80mm = 48; algumas variantes 42) |
| Imprimiu o mesmo 2× | Só acontece se falhar a marcar `printed_at` (log avisa) — muito raro |

## Ficheiros

```
src/
  index.js          arranque (simulador ou produção)
  config.js         lê o .env
  polling.js        poll de pedidos paid+não-impressos → imprime → marca
  printer-client.js envio TCP com retry/backoff
  escpos.js         monta o cupom 80mm ESC/POS (CP1252) + descodificador
  simulator.js      impressora virtual (consola) para testes
  demo.js           `npm run demo` — 2 cupons de exemplo
```
