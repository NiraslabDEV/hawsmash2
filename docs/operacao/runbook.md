# Runbook — operação do HAWSMASH 2.0

> O que a Niraslab faz para manter as duas lojas de pé, e o que fazer quando algo falha.
> A proposta compromete **suporte 7 dias em horário de loja** e **resposta prioritária a qualquer falha que
> impeça vender**. Este documento é como isso se cumpre sem viver agarrado ao telemóvel:
> O objectivo é o sistema avisar cedo. Alertas, emails, backups e deploy automático só contam como
> operacionais depois de configurados e ensaiados na instalação; esta redocumentação não os activou.

---

## 1. Semáforo e alertas disponíveis

Painel **Sistema** (`/sistema`), um bloco por loja, actualizado a cada 30 segundos.
Lê `get_system_status`, `list_system_alerts` e saúde das conversões; um heartbeat é sinal do processo,
não prova de papel na impressora nem de toda a operação financeira. Fontes: [página Sistema](../../apps/web/app/(admin)/sistema/page.tsx)
e [alertas do cron](../../supabase/migrations/20260922193000_1050_alertas_do_cron.sql).

| Sinal implementado | O que conferir |
|---|---|
| Dispositivos | Último heartbeat e alerta `device_silent`, com limiar de cinco minutos no SQL |
| Impressão | Fila pendente/falhada e alerta `print_failed`; não garante saída física |
| Pedido sem papel | `order_not_printed` para pedidos elegíveis há mais de dois minutos, conforme filtros SQL |
| Estoque | Alertas de stock da loja |
| Vendas | `no_sales` depois de 90 minutos segundo o horário/condições definidos na RPC |
| Caixa | Existência de sessão aberta por loja |

A matriz histórica previa níveis adicionais de pagamentos pendentes e fila offline consolidada.
Não estão demonstrados como semáforos implementados nesta página; consultar o pedido/reconciliação e o
contador local do POS. A especificação de um limiar não é prova da sua monitorização activa.

[`/api/cron/alerts`](../../apps/web/app/api/cron/alerts/route.ts) envia email por SMTP se houver agendador,
credenciais e destinatário. O WhatsApp é um **link para uma pessoa abrir/enviar**, não uma mensagem automática.
Há intervalo mínimo de 30 minutos por loja/tipo. O evento `alert.sent` também pode registar `failed`,
`skipped_no_key` ou `skipped_no_recipient`: conferir `payload.delivery`, não apenas o nome do evento.
Configurar `CRON_SECRET` é obrigatório para a instalação; o handler de alertas auditado só verifica o
Bearer quando a variável está preenchida. Essa lacuna consta da [auditoria](../AUDITORIA-DOCUMENTACAO.md).

---

## 2. Rotinas

### Diária (automação a configurar e verificar)
- [ ] Digest ao dono no horário acordado (plano original: 23h); confirmar scheduler, SMTP e destinatário
- [ ] `pg_dump` nocturno e cópia externa independente, com retenção de 30 dias e resultado conferido
- [ ] Rever se as duas lojas comunicaram; a verificação automática de 24 h do plano original precisa de evidência própria

### Semanal (10 minutos, Niraslab)
- [ ] Rever `event_log`: anulações, aberturas de gaveta fora de venda, diferenças de caixa
- [ ] Rever fila de **Conciliação** (vendas offline com divergência)
- [ ] Rever alertas da semana: algum foi ruído? Ajustar limiar
- [ ] Confirmar espaço/limites no Supabase e no Railway

### Mensal (dia 1, dependente do agendador)
- [ ] Resumo do mês ao dono às 08h de Maputo: vendas por loja face ao mês anterior, mais vendidos,
  nota e avaliações no Google. O scheduler chama
  `GET /api/cron/monthly` com `Authorization: Bearer $CRON_SECRET` e cron `0 6 1 * *` (UTC).
  Conferir a deduplicação pelo mês e o resultado de entrega; `?force=1` solicita reenvio, `?month=AAAA-MM` escolhe outro mês.
  Um mês antigo sem fotografia do Google sai sem essa parte. A consulta Google depende de chave/API e Place ID
  configurados por loja. B-114 conserva as pendências; a rota não agenda a sua própria execução.

### Mensal (30 minutos, Niraslab)
- [ ] Confirmar que o resumo do dia 1 chegou (`event_log` `monthly_digest.sent`, `delivery = sent`)
- [ ] **Teste de restauro** de backup para uma BD temporária — registar abaixo
- [ ] Rever contas de equipa: alguém saiu? Remover acesso
- [ ] Relatório ao dono: vendas por loja, produtos, horas de pico, incidentes e o que foi melhorado
- [ ] Rever o registo de **riscos assumidos** (§8): continua verdade? mudou alguma coisa? chegou a data do plano?

### Como correr o backup nocturno

```bash
# Produção. A ligação vem do Supabase → Project Settings → Database → Connection string.
DATABASE_URL="postgres://…" node scripts/backup.mjs --dir /var/backups/hawsmash
```

- Formato **custom** (`pg_dump -Fc`) — é o que o `pg_restore` aceita tabela a tabela.
- Retenção **30 dias**: o script apaga sozinho o que passa disso (`scripts/lib/backup-plan.mjs`).
- O script guarda **só em disco local**. Mesmo com `BACKUP_TARGET`, o envio externo ainda não está
  implementado; outra rotina deve fazer e verificar a cópia (**B-008**). Um destino preenchido não é backup externo.
- `--dry-run` não executa dump nem remove backups, mas pode criar a pasta de destino. Confirmar o ambiente
  e não copiar a ligação com credenciais para logs, documentação ou histórico partilhado.

### Como correr o teste de restauro (mensal)

```bash
# 1. Criar uma BD temporária vazia (nunca restaurar por cima de produção)
createdb hawsmash_restore_teste

# 2. Restaurar o dump mais recente
pg_restore --dbname hawsmash_restore_teste --no-owner --clean --if-exists backup.dump

# 3. Conferir o essencial
psql hawsmash_restore_teste -c "select count(*) from orders;"
psql hawsmash_restore_teste -c "select slug, order_prefix from stores;"
psql hawsmash_restore_teste -c "select max(created_at) from orders;"

# 4. Apagar a BD temporária e registar o resultado na tabela abaixo
dropdb hawsmash_restore_teste
```

### Registo de testes de restauro
| Data | Backup usado | Resultado | Tempo até restaurar | Por |
|---|---|---|---|---|
| — | — | **por executar** — falta ambiente com `pg_dump`/`pg_restore` (**B-014**) | — | — |

*(Backup não testado não é backup. Preencher todos os meses.)*

---

## 3. Incidentes — resposta

> Regra geral: **primeiro repor a venda, depois investigar.** A causa raiz pode esperar; o balcão não.

### 3.1 "A loja não consegue vender"
1. O POS abre com sessão/menu disponíveis? Continuar vendas de balcão offline; não prometer entrada nova,
   mesas, entrega ou fecho de caixa sem servidor. Não limpar dados do navegador.
2. Se o PC não arranca → talonário de papel e [PC de substituição](hardware.md#51-pc-de-substituição--o-que-substitui-o-kit-idêntico).
   Preservar o disco/fila offline do original; configurar vínculo, drivers, bridge e destinos no substituto.
3. Confirmar no painel se a outra loja está a vender (isola loja vs sistema).
4. Se for o sistema: verificar Supabase, Railway e último deploy. Considerar rollback da aplicação depois
   de confirmar compatibilidade com as migrations actuais; não reverter schema nem dados às cegas.

### 3.2 "A cozinha não está a receber pedidos"
1. Painel **Sistema** → bridge e impressora dessa loja.
2. Fila de `print_jobs`: em `queued` (bridge parado) ou `failed` (impressora)?
3. Bridge parado → reiniciar (arranque automático deve tê-lo feito; se não, é bug de watchdog → registar).
4. Impressora → papel, energia e destino: IP/TCP na rede, ou driver/fila Windows/porta série se local.
   O balcão/gerente acompanha o pedido com a sua sessão e transmite-o à cozinha. KDS não está implementado;
   não entregar uma sessão financeira à cozinha como substituto. Ver [manual da cozinha](manual-cozinha.md).
5. Conferir o que foi impresso antes de reimprimir: crash entre envio e confirmação pode duplicar papel.
   Falha física é assíncrona; a auditoria também encontrou caminhos online em que erro SQL ao preparar
   `print_jobs` pode reverter aprovação/confirmação. Verificar o estado persistido do pedido, não o presumir.

### 3.3 "O pagamento não confirmou"
1. Ver `payments` do pedido: chegou webhook? Verificação activa correu?
2. Forçar verificação (`/api/payments/verify`) — não depende do webhook.
3. Valor divergente → **não confirmar**; fica em conciliação e avisa-se o dono. Nunca "aprovar para despachar".
4. Configuração indisponível pode encaminhar para comprovativo. Se a tentativa já foi enviada e o resultado
   é incerto, conservar o pedido/referência e verificar: **não cobrar outra vez** por causa de um timeout.
   Ver [Pagamentos](../modulos/pagamentos.md) e os requisitos do agendador de reconciliação em B-106.

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
2. Se PITR estiver contratado e activo, recuperar para esse instante numa BD nova; caso contrário usar o backup disponível e declarar o intervalo perdido.
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

1. Trabalhar em `dev`; conferir a integração Railway/branch e se o deploy de staging correu.
2. Testar em staging **com a BD de staging** (migrations correm lá primeiro).
3. Lint, testes puros, gate separado de BD, build e E2E aprovados; confirmar protecção de branch e checks
   obrigatórios. Existir um workflow não garante que o merge esteja tecnicamente bloqueado. Ver [testes](../referencia/testes.md).
4. Só promover para `main`/produção depois da validação de staging. Respeitar o horário actual das duas lojas;
   o plano anterior vedava mudanças de schema entre 11h e 21h30.
5. Janela preferida: manhã cedo, com as duas lojas fechadas.
6. Rollback: reverter o deploy no Railway; migrations são forward-only — se for preciso desfazer, escreve-se
   uma migration nova.

---

## 6. Ensaio geral (véspera da abertura, por loja)

> Correr com a loja fechada e o equipamento no sítio definitivo. Demora ~90 minutos.
> Quem conduz: Niraslab. Quem executa: a equipa que vai trabalhar naquela loja.

| # | Ensaio | Como se sabe que passou |
|---|---|---|
| 1 | **20 vendas de balcão** (dinheiro, M-Pesa, cartão e uma mista) | Vias/modelos configurados saem nos destinos certos; gaveta abre só nas de dinheiro |
| 2 | **5 pedidos online** (3 entrega, 2 levantamento) | caem na loja certa, comanda sai, `order-status` acompanha |
| 3 | **1 anulação com motivo** | venda fica `cancelada`, stock repõe, aparece no registo com autor |
| 4 | **1 falha de rede simulada** (desligar o cabo a meio de uma venda) | POS mostra `SEM LIGAÇÃO`, talão sai na mesma, sincroniza ao voltar |
| 5 | **1 falha de impressora** (desligar a impressora da cozinha) | venda grava, painel avisa, reimprime quando volta |
| 6 | **1 fecho de caixa completo** | diferença explicada, talão de fecho impresso, email ao dono recebido |
| 7 | **Alerta automático** (deixar um dispositivo desligado 6 minutos) | Com scheduler/SMTP configurados, email chega e `payload.delivery=sent`; confirmar também a caixa do destinatário |
| 8 | **TVs** ligadas em `/tv/[loja]/menu` e `/tv/[loja]/senhas` | número do dia aparece ao marcar Pronto |

Registar o resultado de cada linha e **só assinar a checklist de abertura depois de todas passarem**.

Manuais a entregar no fim: [`manual-caixa.md`](manual-caixa.md), [`manual-cozinha.md`](manual-cozinha.md),
[`manual-dono.md`](manual-dono.md).

---

## 7. Checklist de abertura (assinar por loja)

**Loja: ____________  Data: ______  Responsável Niraslab: ____________**

- [ ] Rede: cabo, IPs fixos, 4G de reserva testado (desligar o principal e confirmar que a venda continua)
- [ ] UPS ligado e testado (10 min sem energia)
- [ ] Impressora da cozinha: teste OK · Impressora do balcão: teste OK · Gaveta: abre OK
- [ ] POS instalado em kiosk, arranca sozinho, ligado à loja certa
- [ ] print-bridge com `STORE_ID` correcto, heartbeat verde no painel
- [ ] Cópia cifrada do `.env` e do `.exe` do bridge guardada **fora** da máquina, e ensaio de PC de substituição registado (§8)
- [ ] **(Matola)** risco do sistema operativo/cobertura actual revisto e mitigações conferidas — [hardware](hardware.md#3-configuração-do-pc-do-balcão)
- [ ] No ambiente autorizado, `scripts/check-placeholders.mjs` sai a zero; complementar a revisão porque
  o script cobre só campos de lojas, zonas e equipa, sem paginação, e não está ligado ao build
- [ ] Cardápio conferido (nomes, preços, fotos, disponibilidade) pelo dono
- [ ] Horário e zonas de entrega da loja conferidos
- [ ] Carteiras/contas de destino conferidas; o ensaio histórico de pagamento real de 1 MT só é feito
  pelo responsável com autorização específica para dinheiro real, nunca como efeito automático desta checklist
- [ ] Contas da equipa criadas com o perfil certo; PINs entregues
- [ ] Fundo de caixa inicial definido e lançado
- [ ] Os dez [testes de hardware](hardware.md#4-testes-de-aceitação-fazer-com-o-equipamento-na-mão-antes-de-ir-para-a-loja) passados e registados
- [ ] Ensaio: 20 vendas de balcão, 5 delivery, 1 fecho de caixa completo
- [ ] Folha A4 de contingência plastificada e afixada
- [ ] Equipa formada (caixa, cozinha, responsável) e manual entregue

**Assinatura Niraslab: ____________  Assinatura HAWSMASH: ____________**


---

## 8. Riscos assumidos

> Riscos conhecidos, aceites por decisão consciente, com data, mitigação e plano. Esta secção existe para que
> nenhum deles apareça como surpresa daqui a um ano. Rever na rotina mensal (§2).

### R-001 · Windows 10 sem actualizações de segurança — **Matola**

| | |
|---|---|
| **O quê** | Registo de 22/08/2026: WINTEC AnyPOS100/i5-7200U com Windows 10 Pro 22H2, tratado como sem suporte normal desde 14/10/2025. Confirmar inventário e cobertura/licença efectiva; não houve inspecção nesta redocumentação |
| **Porque não se resolve já** | O i5-7200U é de 7.ª geração e fica abaixo do requisito de CPU do Windows 11. Forçar a instalação deixava a máquina sem actualizações na mesma e com mais superfície para partir — numa máquina que vende, não se faz |
| **Aceite em** | 22/08/2026 — Gabriel dos Santos (Niraslab), com o dono informado por escrito antes da compra da segunda máquina |
| **Mitigações** | Conta sem admin · sem navegação (kiosk) · sem portas de entrada · protecção actualizada · acesso remoto controlado · nada mais instalado. Lista em [hardware](hardware.md#3-configuração-do-pc-do-balcão) |
| **Limite das mitigações** | A chave do bridge é `service_role` e contorna RLS; não está restrita à loja. IndexedDB depende da integridade do navegador/disco. Um PC comprometido ou avariado pode perder a fila ainda não sincronizada |
| **Plano** | Substituir o PC da Matola em **2027**. Maputo abre já com CPU de 8.ª geração ou superior |
| **Revisão** | Mensal (§2). Qualquer indício de compromisso é incidente **L1 imediato** (§4) |

### Registo de ensaios de PC de substituição

Procedimento em [hardware](hardware.md#51-pc-de-substituição--o-que-substitui-o-kit-idêntico). Meta a medir: primeiro talão em menos de 30 minutos.

| Data | Loja | Tempo até ao primeiro talão | Por |
|---|---|---|---|
| — | Maputo | **por executar** | — |
| — | Matola | **por executar** | — |

### Quem tem acesso remoto (AnyDesk)

| Loja | Máquina | Quem | Revisto em |
|---|---|---|---|
| Matola | AnyPOS100 | **a preencher antes da abertura** | — |
| Maputo | a adquirir | **a preencher antes da abertura** | — |
