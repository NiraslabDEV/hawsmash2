# Print-bridge — impressora térmica ESC/POS (single-tenant)

Serviço Node leve que corre no **mini-PC local** do restaurante (24/7). Faz poll de `print_jobs.queued`
no Supabase (3s) → render ESC/POS → TCP `PRINTER_IP:9100` → marca `printed`. Retry 3× com backoff
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
PRINTER_IP=192.168.1.100
PRINTER_PORT=9100
USE_SIMULATOR=false        # true = simulador TCP (sem hardware)
```

## Desenvolvimento (simulador)

Sem impressora física — imprime o cupom decodificado (CP1252) no console:

```bash
pnpm dev                   # dentro de services/print-bridge
# ou, da raiz:
pnpm bridge:dev
```

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

## Troubleshooting

| Sintoma | Verificar |
|---|---|
| Impressora não responde | `ping <PRINTER_IP>`, `telnet <PRINTER_IP> 9100`, papel/online, firewall porta 9100 |
| Jobs não imprimem | credenciais Supabase, `print_jobs` com `status='queued'`, logs do bridge |
| Simulador não arranca | `USE_SIMULATOR=true`, porta 9100 livre (`netstat -an \| grep 9100`) |

## Notas de segurança

Usa `SUPABASE_SERVICE_ROLE_KEY` (acesso admin) — manter o mini-PC em LAN segura, nunca commitar `.env`.
