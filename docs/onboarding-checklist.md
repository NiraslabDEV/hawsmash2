# Checklist de entrega — cliente novo

> Copia este ficheiro por cliente (ex: `docs/clientes/cantinho-da-maria.md`) e vai marcando.
> Meta: restaurante operacional em **< 30 min**, sem tocar em lógica.

**Cliente:** _______________________  **Data:** ____/____/______  **Responsável:** ____________

---

## 1. Repositório e marca
- [ ] Repo clonado para a pasta/serviço do cliente
- [ ] `cp config/brand.example.ts config/brand.ts` e editado: `name`, `tagline`, cores (`theme`), redes
- [ ] Logo + assets colocados em `apps/web/public/assets`
- [ ] `name` ≠ "Restaurante Demo"

## 2. Supabase
- [ ] Projeto Supabase criado para o cliente
- [ ] `cp .env.example .env` preenchido (URL, anon key, service role key)
- [ ] Migrations aplicadas: `pnpm setup:client` (ou `supabase db reset`)
- [ ] Seed carregado (categorias/itens/zonas de exemplo)
- [ ] Bucket privado `payment-proofs` existe (vem da migration)

## 3. Pagamento
- [ ] `PAYMENT_PROVIDER` definido (`manual` para arrancar)
- [ ] (Se `paysuite`) `PAYSUITE_API_KEY` + `PAYSUITE_WEBHOOK_SECRET` + `CRON_SECRET` definidos
- [ ] (Se `paysuite`) Webhook configurado no painel Paysuite → `APP_BASE_URL/api/webhooks/paysuite`

## 4. Email
- [ ] `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (domínio verificado no Resend)
- [ ] `OWNER_EMAIL` = email real do dono
- [ ] Teste: criar pedido → dono recebe email "novo pedido"

## 5. Configuração no admin (settings/menu)
- [ ] Login do dono criado (Supabase Auth)
- [ ] `settings`: números/nomes M-Pesa e e-Mola, morada de levantamento + link de mapa
- [ ] `settings`: horários (`open_hour`/`close_hour`/`slot_minutes`), `accepting_orders=true`
- [ ] Cardápio real: categorias + itens (foto, preço, descrição)
- [ ] Zonas de entrega + taxas reais

## 6. Deploy
- [ ] Deploy do web (Vercel ou Railway) com todas as env vars
- [ ] `APP_BASE_URL` aponta para o domínio de produção
- [ ] (Opcional) Domínio personalizado ligado
- [ ] Smoke test em produção: cardápio → carrinho → checkout → comprovativo → aprovar

## 7. Impressora (opcional)
- [ ] `print-bridge` instalado no mini-PC local 24/7
- [ ] `.env` do bridge: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PRINTER_IP`
- [ ] Teste real: pedido aprovado/pago → cupom sai na impressora
- [ ] Heartbeat verde no painel (impressora online)

## 8. Entrega ao cliente
- [ ] Credenciais do admin entregues ao dono
- [ ] Formação rápida: aprovar/negar pedidos, fechar caixa, ver análise
- [ ] Link da loja partilhado / QR para redes
