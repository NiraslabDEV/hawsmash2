# Variáveis de ambiente

Só se listam **nomes**, nunca valores. A comparação incluiu process.env, helpers required(), env injectada e nomes dinâmicos de impressoras; não se classificou uma variável como obsoleta só por não aparecer como process.env.NOME.

### Exemplo raiz: 45 nomes declarados

| Grupo | Nomes |
|---|---|
| Supabase | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, SUPABASE_ANON_KEY |
| Pagamentos | PAYMENT_PROVIDER, PAYSUITE_API_KEY, PAYSUITE_WEBHOOK_SECRET, MPESA_API_KEY, MPESA_PUBLIC_KEY, MPESA_SERVICE_PROVIDER_CODE, MPESA_SESSION_BASE_URL, MPESA_CHARGE_BASE_URL, MPESA_QUERY_BASE_URL |
| Email | SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, OWNER_EMAIL |
| Aplicação/agentes | APP_BASE_URL, NEXT_PUBLIC_APP_BASE_URL, AGENT_TOOLS_ENABLED, AGENT_PUBLIC_BASE_URL, AGENT_ALLOWED_ORIGINS, NEXT_PUBLIC_DEFAULT_STORE_SLUG, BRAND_NAME |
| Cron/Google/conversões | CRON_SECRET, GOOGLE_PLACES_API_KEY, META_CAPI_TOKEN, GOOGLE_ADS_DEVELOPER_TOKEN, GADS_OAUTH_TOKEN, GADS_CUSTOMER_ID, GADS_CONVERSION_ACTION |
| Subconjunto bridge | STORE_ID, PRINTER_IP_KITCHEN, PRINTER_IP_COUNTER, PRINTER_PORT, LOCAL_HTTP_PORT, LOCAL_TOKEN |
| Observabilidade/backup | SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_TRACES_SAMPLE_RATE, DATABASE_URL, BACKUP_TARGET |

### Exemplo bridge: 30 nomes declarados

SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STORE_ID, BRIDGE_DEVICE_ID, BRIDGE_APP_VERSION, PRINTER_IP_KITCHEN, PRINTER_IP_COUNTER, PRINTER_PORT, PRINTER_COUNTER, PRINTER_KITCHEN, POLL_INTERVAL_MS, LOCAL_HTTP_PORT, LOCAL_TOKEN, LOCAL_ALLOWED_ORIGINS, LOCAL_STATE_FILE, CUSTOMER_DISPLAY_PORT, CUSTOMER_DISPLAY_BAUD, CUSTOMER_DISPLAY_COLUMNS, CUSTOMER_DISPLAY_PROTOCOL, CUSTOMER_DISPLAY_IDLE_TEXT, CUSTOMER_DISPLAY_IDLE_SUBTEXT, CUSTOMER_DISPLAY_IDLE_STEP_MS, CUSTOMER_DISPLAY_IDLE_AFTER_MS, BRAND_NAME, BRAND_LOGO_FILE, USE_SIMULATOR, SIMULATOR_PORT, SIMULATOR_VERBOSE, SENTRY_DSN, SENTRY_ENVIRONMENT.

### Consumidas e ausentes dos dois exemplos

| Nome | Consumidor | Classificação |
|---|---|---|
| LOCAL_HTTP_HOST | `services/print-bridge/src/config.ts:106` | Configuração opcional de binding HTTP |
| PRINT_LAYOUT_FILE | `services/print-bridge/src/config.ts:111` | Configuração opcional de cache em disco; já mencionada no README bridge |
| NEXT_PUBLIC_SENTRY_DSN | `apps/web/instrumentation.ts:7` | Alternativa/fallback de configuração Sentry |
| META_TEST_EVENT_CODE | `apps/web/lib/server-analytics/conversions.ts:93` | Diagnóstico opcional de conversões |
| LEGACY_SUPABASE_URL | `scripts/import-hawsmash-1.ts:71` | Apenas importação legada, não arranque normal |
| LEGACY_SERVICE_KEY | `scripts/import-hawsmash-1.ts:71` | Apenas importação legada; segredo, valor nunca documentado |

**Não se encontrou nome dos exemplos sem consumidor**, considerando os acessos indirectos. BACKUP_TARGET é consumido mas não implementa o envio externo. BRIDGE_DEVICE_ID e LOCAL_ALLOWED_ORIGINS faltam do exemplo raiz, mas existem no do bridge e são obrigatórios no serviço.

NODE_ENV pertence ao framework; NEXT_PUBLIC_APP_BUILD é gerado pelo Next config; RAILWAY_GIT_COMMIT_SHA é infra; AGENT_E2E_REUSE é opção exclusiva de teste. Variáveis Windows ProgramFiles/USERNAME são do SO. Não são seis novas configurações obrigatórias da aplicação.

O problema de obsolescência existe em **turbo.globalEnv**, que ainda inclui RESEND_API_KEY/RESEND_FROM_EMAIL e omite famílias actuais. Não se altera esse JSON numa tarefa documental.

Fontes: [exemplo raiz](../../.env.example), [exemplo bridge](../../services/print-bridge/.env.example). Nunca copiar ficheiros de ambiente reais para documentação. [Instalação](../operacao/instalacao.md) e [arranque de desenvolvimento](../../README.md) distinguem web, bridge e ferramentas pontuais.
