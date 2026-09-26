# Print-bridge — impressão ESC/POS por loja

Serviço Node leve que corre no **PC local de cada loja** (24/7). Faz poll de `print_jobs.queued`
filtrado pelo seu `STORE_ID` (3s por omissão) → escolhe cozinha/balcão → ESC/POS → marca `printed`.
O transporte faz até três tentativas, com esperas de 1s e 2s por omissão; falha → `failed` + `event_log`.
**Falha física de impressão não esconde o pedido no painel.**

> Corre no mini-PC, **não na cloud** — usa impressora TCP na LAN, fila Windows ou porta série.
> O papel de referência é **80 mm, 48 colunas, CP1252** (24 colunas com largura dupla), conforme
> [Impressão](../../docs/modulos/impressao.md) e [pacote receipt](../../packages/receipt/src/).

**Estado:** código local revisto em 26/09/2026. Simulador, hardware, tarefas Windows e produção não foram
executados nesta revisão. Instalação e ensaios: [hardware](../../docs/operacao/hardware.md),
[checklist](../../docs/operacao/instalacao.md), [runbook](../../docs/operacao/runbook.md) e
[manual de cozinha](../../docs/operacao/manual-cozinha.md). Pendências físicas: B-006/B-018 em
[BLOQUEIOS](../../BLOQUEIOS.md).

## Instalação

Da raiz, em PowerShell:

```powershell
cd services/print-bridge
pnpm install
Copy-Item -LiteralPath .env.example -Destination .env
```

`.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # SECRETO — só no mini-PC
STORE_ID=00000000-0000-4000-8000-000000000101
BRIDGE_DEVICE_ID=00000000-0000-4000-8000-000000000201
BRIDGE_APP_VERSION=2.0.0
PRINTER_IP_KITCHEN=192.168.1.50
PRINTER_IP_COUNTER=192.168.1.51
PRINTER_PORT=9100
USE_SIMULATOR=false        # true = simulador TCP (sem hardware)
LOCAL_HTTP_HOST=0.0.0.0
LOCAL_HTTP_PORT=7777
LOCAL_TOKEN=trocar-por-token-aleatorio-com-32-caracteres
LOCAL_ALLOWED_ORIGINS=https://staging.hawsmash.co.mz,https://hawsmash.co.mz
LOCAL_STATE_FILE=./data/local-requests.log
PRINT_LAYOUT_FILE=./data/print-layout.json   # opcional — cópia do modelo do talão (aba POS)
```

Os IDs, destinos e origens acima são exemplos; substituir pelos da instalação. `PRINTER_KITCHEN` e
`PRINTER_COUNTER` aceitam `tcp://`, `windows://` e `serial://`, com prioridade sobre os antigos
`PRINTER_IP_*`. Ver o [.env.example](.env.example) para o visor e a marca; nunca versionar o `.env` real.

## Modelo do talão (aba POS)

Os formatos do papel vivem em `packages/receipt` (`@delivery/receipt`), partilhados com a
pré-visualização do painel. O bridge lê o layout da sua loja (`store_pos_settings.config.printing`)
ao arrancar e de minuto a minuto, e guarda uma cópia em `PRINT_LAYOUT_FILE`: sem rede — e depois de
um reinício sem rede — o talão sai como a loja escolheu. Sem cópia e sem rede, sai o de fábrica.
Um erro a ler nunca pára a impressão. O de fábrica produz os mesmos bytes que antes
(`src/__tests__/talao-bytes.test.ts`). Ver [POS](../../docs/modulos/pos.md),
[Impressão](../../docs/modulos/impressao.md) e [ADR 0007](../../docs/decisions/0007-modelos-do-talao.md).

## API HTTP local

O bridge expõe `GET /health`, `POST /print`, `POST /drawer` e `POST /display` na LAN. Todos os pedidos exigem
`Authorization: Bearer <LOCAL_TOKEN>`. Os pedidos de impressão/gaveta recebem um `requestId` único; o bridge guarda-o
num registo local persistente depois de concluir impressão/gaveta, evitando repetir pedidos já confirmados
no ledger, inclusive depois de reiniciar. `display` apenas actualiza o visor e não usa esse ledger.

Existe uma janela de resultado incerto: crash depois do envio físico e antes da gravação pode repetir
papel/pulso. Na fila, o mesmo vale entre envio e confirmação de `printed`. Não se promete exactamente uma
impressão em qualquer falha; ver a auditoria R-05 no [relatório](../../docs/AUDITORIA-DOCUMENTACAO.md).

Exemplo técnico para ensaio autorizado da gaveta (não substitui o fluxo de perfil/PIN do POS):

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:7777/drawer' `
  -Headers @{ Authorization = "Bearer $env:LOCAL_TOKEN" } `
  -ContentType 'application/json' `
  -Body '{"requestId":"drawer-018f1f4e-7ec8-7a29-a9df-3f0652f8ea2a"}'
```

`LOCAL_ALLOWED_ORIGINS` é obrigatório e deve listar apenas as origens exactas autorizadas a chamar o
bridge a partir do browser. Clientes locais sem cabeçalho `Origin` continuam suportados. O token nunca é
devolvido pelo endpoint de saúde nem escrito nos logs.

## Desenvolvimento (simulador)

**Demo independente**, sem Supabase nem impressora física: inicia o simulador TCP, envia um pedido
sintético, mostra o talão decodificado em CP1252 na consola e termina. Da raiz, também em PowerShell:

```powershell
pnpm --filter print-bridge dev:sim
```

**Serviço completo com impressora simulada:** continua a ler a configuração e a consultar/alterar a fila
na BD configurada. Usar apenas uma instalação de ensaio, com a configuração conferida:

```powershell
$env:USE_SIMULATOR = 'true'
$env:SIMULATOR_PORT = '9100'
$env:SIMULATOR_VERBOSE = 'true'
pnpm --filter print-bridge dev
```

`pnpm dev` sozinho não activa o simulador. O atalho `pnpm bridge:dev` da raiz usa atribuições de ambiente
POSIX e não é um comando PowerShell compatível; usar uma das formas explícitas acima. Nenhum destes
ensaios comprova margens, corte, gaveta, papel ou porta série do equipamento real.

## Windows: `.exe`, arranque automático e watchdog

Gerar o executável no Windows (Node 22 ou 24):

```powershell
pnpm --filter print-bridge build:sea
```

O resultado fica em `services/print-bridge/build/hawsmash-print-bridge.exe`. Coloca um `.env` preenchido
no mesmo directório do executável e instala a tarefa como Administrador:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\install-task.ps1
```

A tarefa arranca com o Windows sob `SYSTEM` e reinicia o processo após 1 minuto em caso de crash. Para a
remover: `powershell -ExecutionPolicy Bypass -File .\windows\uninstall-task.ps1`.

O bridge envia heartbeat a cada 60 segundos para `devices`, sempre com `STORE_ID` e `BRIDGE_DEVICE_ID`.
O watchdog corre no mesmo intervalo: jobs em `printing` há mais de 2 minutos voltam para `queued`; após três
tentativas passam a `failed`. Cada recuperação ou falha fica em `event_log`.

## Produção (systemd no mini-PC)

`/etc/systemd/system/print-bridge.service`:
```ini
[Unit]
Description=Delivery OS Print Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/print-bridge/print-bridge
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node /home/print-bridge/print-bridge/node_modules/.bin/tsx src/index.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable print-bridge && sudo systemctl start print-bridge
sudo systemctl status print-bridge
```

## Ciclo de vida do print_job

O online enfileira na confirmação/aprovação; o POS e as mesas têm produtores próprios de trabalhos.
Estados: `queued` → `printing` → `printed` | `failed`.
Cada bridge consulta e actualiza apenas jobs do seu `STORE_ID`. `order` vai para a cozinha quando
`station` não é `counter`; com `station=counter`, segue para o balcão. `receipt`, `drawer`, `cash_close`
e `test` vão para o balcão. As vias e modelos são escolhidos pelo domínio, não inferidos da existência
de duas impressoras. A auditoria V-16 distingue falha física assíncrona de erro SQL ao enfileirar, que
ainda pode reverter confirmação/aprovação online.

## Troubleshooting

| Sintoma | Verificar |
|---|---|
| Impressora não responde | `ping <PRINTER_IP>`, `telnet <PRINTER_IP> 9100`, papel/online, firewall porta 9100 |
| Jobs não imprimem | `STORE_ID`, credenciais Supabase, fila `queued` dessa loja e logs do bridge |
| Simulador não arranca | Escolher demo ou serviço completo; verificar porta 9100 livre em PowerShell com `Get-NetTCPConnection -LocalPort 9100 -ErrorAction SilentlyContinue` |

## Notas de segurança

Usa `SUPABASE_SERVICE_ROLE_KEY` (acesso admin) — manter o mini-PC em LAN segura, nunca commitar `.env`.
