# Print-bridge — impressão ESC/POS por loja

Serviço Node leve que corre no **PC local de cada loja** (24/7). Faz poll de `print_jobs.queued`
filtrado pelo seu `STORE_ID` (3s) → escolhe cozinha/balcão → ESC/POS TCP 9100 → marca `printed`. Retry 3× com backoff
(1s, 3s, 9s) → `failed` + `event_log`. **Falha de impressão nunca esconde o pedido no painel.**

> Corre no mini-PC, **não na cloud** — precisa de ligação TCP à impressora na LAN do restaurante.
> O formato completo do cupom está no [README raiz](../../README.md#formato-do-cupom-térmico-escpos--58-mm).

## Instalação

```bash
cd services/print-bridge
pnpm install
cp .env.example .env
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

## Modelo do talão (aba POS)

Os formatos do papel vivem em `packages/receipt` (`@delivery/receipt`), partilhados com a
pré-visualização do painel. O bridge lê o layout da sua loja (`store_pos_settings.config.printing`)
ao arrancar e de minuto a minuto, e guarda uma cópia em `PRINT_LAYOUT_FILE`: sem rede — e depois de
um reinício sem rede — o talão sai como a loja escolheu. Sem cópia e sem rede, sai o de fábrica.
Um erro a ler nunca pára a impressão. O de fábrica produz os mesmos bytes que antes
(`src/__tests__/talao-bytes.test.ts`). Ver `docs/POS-DEFINICOES.md` §Impressão e ADR 0007.

## API HTTP local

O bridge expõe `GET /health`, `POST /print` e `POST /drawer` na LAN. Todos os pedidos exigem
`Authorization: Bearer <LOCAL_TOKEN>`. Os pedidos `POST` recebem um `requestId` único; o bridge guarda-o
num registo local persistente e não volta a produzir papel nem a abrir a gaveta quando o mesmo pedido é
repetido, inclusive depois de reiniciar.

Exemplo:

```bash
curl -X POST http://127.0.0.1:7777/drawer \
  -H "Authorization: Bearer $LOCAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"drawer-018f1f4e-7ec8-7a29-a9df-3f0652f8ea2a"}'
```

`LOCAL_ALLOWED_ORIGINS` é obrigatório e deve listar apenas as origens exactas autorizadas a chamar o
bridge a partir do browser. Clientes locais sem cabeçalho `Origin` continuam suportados. O token nunca é
devolvido pelo endpoint de saúde nem escrito nos logs.

## Desenvolvimento (simulador)

Sem impressora física — imprime o cupom decodificado (CP1252) no console:

```bash
pnpm dev                   # dentro de services/print-bridge
# ou, da raiz:
pnpm bridge:dev
```

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

O job nasce quando o pedido fica `paid` (Paysuite) ou `approved` (manual), na mesma transação.
Estados: `queued` → `printing` → `printed` | `failed`.
Cada bridge consulta e actualiza apenas jobs do seu `STORE_ID`. `order` vai para a cozinha; `receipt`,
`drawer`, `cash_close` e `test` vão para a impressora do balcão.

## Troubleshooting

| Sintoma | Verificar |
|---|---|
| Impressora não responde | `ping <PRINTER_IP>`, `telnet <PRINTER_IP> 9100`, papel/online, firewall porta 9100 |
| Jobs não imprimem | `STORE_ID`, credenciais Supabase, fila `queued` dessa loja e logs do bridge |
| Simulador não arranca | `USE_SIMULATOR=true`, porta 9100 livre (`netstat -an \| grep 9100`) |

## Notas de segurança

Usa `SUPABASE_SERVICE_ROLE_KEY` (acesso admin) — manter o mini-PC em LAN segura, nunca commitar `.env`.
