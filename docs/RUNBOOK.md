# RUNBOOK.md — operação do HAWSMASH 2.0

> O que a Niraslab faz para manter as duas lojas de pé, e o que fazer quando algo falha.
> A proposta compromete **suporte 7 dias em horário de loja** e **resposta prioritária a qualquer falha que
> impeça vender**. Este documento é como isso se cumpre sem viver agarrado ao telemóvel:
> **o sistema avisa primeiro, o humano decide depois.**

---

## 1. Semáforo — o que está sempre a ser vigiado

Painel **Sistema** (`/admin/sistema`), um bloco por loja:

| Sinal | Verde | Amarelo | Vermelho |
|---|---|---|---|
| **POS** | heartbeat < 2 min | 2–5 min | > 5 min em horário de loja |
| **print-bridge** | heartbeat < 2 min | 2–5 min | > 5 min |
| **Impressoras** | último job impresso OK | 1 falha | 3 falhas seguidas ou fila > 5 |
| **Vendas** | venda na última hora | 90 min sem venda em pico | 3 h sem venda em horário de loja |
| **Pagamentos** | webhooks a chegar | 1 pendente > 10 min | 3 pendentes ou API em erro |
| **Sincronização POS** | fila offline vazia | 1–5 por sincronizar | > 5 ou > 30 min por sincronizar |

**Alertas automáticos** (email + WhatsApp) disparam nos estados **vermelhos** e no stock crítico.
Alerta é sempre accionável: diz **qual loja, qual dispositivo, desde quando e o que fazer**.

---

## 2. Rotinas

### Diária (automática)
- [ ] Digest ao dono às 23h: vendas por loja, fecho de caixa, diferenças, incidentes
- [ ] `pg_dump` nocturno para armazenamento externo (retenção 30 dias)
- [ ] Verificação automática de que as duas lojas comunicaram nas últimas 24 h

### Semanal (10 minutos, Niraslab)
- [ ] Rever `event_log`: anulações, aberturas de gaveta fora de venda, diferenças de caixa
- [ ] Rever fila de **Conciliação** (vendas offline com divergência)
- [ ] Rever alertas da semana: algum foi ruído? Ajustar limiar
- [ ] Confirmar espaço/limites no Supabase e no Railway

### Mensal (30 minutos, Niraslab)
- [ ] **Teste de restauro** de backup para uma BD temporária — registar abaixo
- [ ] Rever contas de equipa: alguém saiu? Remover acesso
- [ ] Relatório ao dono: vendas por loja, produtos, horas de pico, incidentes e o que foi melhorado

### Registo de testes de restauro
| Data | Backup usado | Resultado | Tempo até restaurar | Por |
|---|---|---|---|---|
| | | | | |

*(Backup não testado não é backup. Preencher todos os meses.)*

---

## 3. Incidentes — resposta

> Regra geral: **primeiro repor a venda, depois investigar.** A causa raiz pode esperar; o balcão não.

### 3.1 "A loja não consegue vender"
1. O POS abre? Se sim, vende offline — confirmar com a equipa que **continuem a vender**.
2. Se o PC não arranca → talonário de papel (`docs/HARDWARE.md §5`) e substituição/assistência.
3. Confirmar no painel se a outra loja está a vender (isola loja vs sistema).
4. Se for o sistema: verificar Supabase (status), Railway (deploy), último merge. **Rollback do último deploy**
   é a acção mais rápida e quase sempre a certa.

### 3.2 "A cozinha não está a receber pedidos"
1. Painel **Sistema** → bridge e impressora dessa loja.
2. Fila de `print_jobs`: em `queued` (bridge parado) ou `failed` (impressora)?
3. Bridge parado → reiniciar (arranque automático deve tê-lo feito; se não, é bug de watchdog → registar).
4. Impressora → papel, cabo, IP, ping. Enquanto isso: **a cozinha lê no ecrã**; a venda nunca esteve em risco.
5. Reimprimir os jobs falhados pelo painel.

### 3.3 "O pagamento não confirmou"
1. Ver `payments` do pedido: chegou webhook? Verificação activa correu?
2. Forçar verificação (`/api/payments/verify`) — não depende do webhook.
3. Valor divergente → **não confirmar**; fica em conciliação e avisa-se o dono. Nunca "aprovar para despachar".
4. Paysuite em baixo → o checkout cai sozinho no fluxo manual por comprovativo (CLAUDE §11.9). Confirmar que caiu.

### 3.4 "A caixa não bate"
1. Fecho conta **desde o último fecho**, no fuso da loja. Confirmar que não houve fecho a meio.
2. Ver `cash_movements` (sangrias/reforços registados?) e vendas em dinheiro vs móvel/cartão.
3. Ver `event_log`: aberturas de gaveta fora de venda, anulações depois de cobrada.
4. Diferença acima da tolerância exige motivo — o motivo já ficou gravado no fecho.

### 3.5 "Vendas duplicadas"
Não deveria acontecer (idempotência por `client_sale_id`). Se acontecer: **é bug grave** — recolher os dois
`order_id`, o `client_sale_id` e a hora, abrir incidente, escrever o teste que reproduz **antes** de corrigir.

### 3.6 Perda de dados
1. Determinar o momento exacto anterior à perda.
2. PITR do Supabase (Pro) para esse instante numa BD nova.
3. Extrair só o que falta e reinserir — **nunca** restaurar por cima da produção com as lojas a vender.
4. Escrever o post-mortem em `docs/decisions/`.

---

## 4. Escalonamento

| Nível | Quando | Quem |
|---|---|---|
| **L0 — equipa da loja** | papel, gaveta, reiniciar o PC | responsável de turno |
| **L1 — Niraslab** | qualquer alerta vermelho, falha de venda, dúvida de caixa | Gabriel · niraslab.dev@gmail.com · WhatsApp |
| **L2 — fornecedor** | Supabase / Railway / Paysuite / ISP em baixo | conta de suporte respectiva |

**Compromisso de resposta (proposta §6):** prioridade absoluta a qualquer falha que impeça vender, nos
7 dias da semana, em horário de funcionamento.

---

## 5. Mudanças em produção

1. Trabalhar em `dev` → deploy automático para staging.
2. Testar em staging **com a BD de staging** (migrations correm lá primeiro).
3. `pnpm lint && pnpm test` verdes (CI trava o merge).
4. Merge em `main` → produção. **Nunca entre as 11h e as 21h30** (horário de loja) para mudanças de schema.
5. Janela preferida: manhã cedo, com as duas lojas fechadas.
6. Rollback: reverter o deploy no Railway; migrations são forward-only — se for preciso desfazer, escreve-se
   uma migration nova.

---

## 6. Checklist de abertura (assinar por loja)

**Loja: ____________  Data: ______  Responsável Niraslab: ____________**

- [ ] Rede: cabo, IPs fixos, 4G de reserva testado (desligar o principal e confirmar que a venda continua)
- [ ] UPS ligado e testado (10 min sem energia)
- [ ] Impressora da cozinha: teste OK · Impressora do balcão: teste OK · Gaveta: abre OK
- [ ] POS instalado em kiosk, arranca sozinho, ligado à loja certa
- [ ] print-bridge com `STORE_ID` correcto, heartbeat verde no painel
- [ ] Cardápio conferido (nomes, preços, fotos, disponibilidade) pelo dono
- [ ] Horário e zonas de entrega da loja conferidos
- [ ] Números M-Pesa/e-Mola da loja conferidos (**teste de pagamento real de 1 MT**)
- [ ] Contas da equipa criadas com o perfil certo; PINs entregues
- [ ] Fundo de caixa inicial definido e lançado
- [ ] Os 10 testes de aceitação do `docs/HARDWARE.md §4` passados e registados
- [ ] Ensaio: 20 vendas de balcão, 5 delivery, 1 fecho de caixa completo
- [ ] Folha A4 de contingência plastificada e afixada
- [ ] Equipa formada (caixa, cozinha, responsável) e manual entregue

**Assinatura Niraslab: ____________  Assinatura HAWSMASH: ____________**
