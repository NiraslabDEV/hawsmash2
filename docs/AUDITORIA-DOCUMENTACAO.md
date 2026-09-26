# Auditoria da documentação — HAWSMASH 2.0

Data: **26 de Setembro de 2026**. Entrega das **Fases 1 e 2**, para aprovação antes da reorganização.

## 1. Âmbito e retrato auditado

O sistema cresceu além do mapa principal: existem **16 abas do painel, 30 páginas, 34 endpoints HTTP, quatro pacotes e um serviço de impressão**. A documentação mistura regras vigentes, descrição do motor anterior, planos e resultados de corridas antigas. A solução proposta é manter as decisões na spec/ADRs, concentrar o funcionamento em documentos de módulo e separar referência técnica de procedimentos e evidência histórica.

Resultado: **35 discrepâncias documentais**, **16 violações da spec identificadas estaticamente** e oito riscos/limitações adicionais. Nenhuma foi corrigida no código ou nos documentos existentes nesta fase.

- Branch criada a partir de `dev`: **`docs/revisao-geral`**.
- Base: `a30c95987703ad1435233904438d67007e1c9f98`, último commit de `dev` observado no início.
- **Objecto da auditoria: a árvore de trabalho**, incluindo alterações anteriores ainda não commitadas. Não equivale ao que está publicado em staging ou produção.
- Já estavam modificados `.env.example`, a spec, o roadmap, os bloqueios, POS, talões, testes e documentos operacionais. Já existiam ficheiros novos de Google/resumo mensal, extras e migrations 1077, 1078 e 1096. Foram preservados.
- O endpoint mensal conta nas **34 APIs da árvore de trabalho**; no commit base existem 33. As migrations são **149 na árvore**, 146 no commit base.
- Leitura inicial: AGENTS → CLAUDE completo → README → ROADMAP → ROADMAP-PRODUTO → BLOQUEIOS → sete ADRs. Seguiu-se inventário dos ficheiros, pesquisa transversal de símbolos e leitura dos fluxos, handlers, permissões, configurações e cadeia de migrations.
- Não foram abertos ficheiros `CREDENCIAIS*`, ficheiros de ambiente reais, nem as pastas excluídas pelo pedido. Só se consultaram os dois exemplos de ambiente. Não se reproduzem contactos privados nem valores de credenciais.
- **Nenhum SQL, deploy, envio de email, pagamento ou consulta a uma instalação foi executado.** Os achados de segurança abaixo são conclusões de leitura estática; não são incidentes observados.
- Nesta fase só se acrescenta este relatório. Nenhum documento existente é corrigido ou movido; nenhuma decisão é alterada.

As referências `ficheiro:linha` dizem respeito a este retrato. As contagens de testes são contagens de ficheiros/declarações, não resultados de testes.

## 2. Discrepâncias documentais

Todas as correcções desta tabela são **propostas para a Fase 3**. Regras contraditas pelo código permanecem regras; os casos correspondentes estão na secção 5.

| ID | Doc / o que diz | O que existe hoje | Evidência | Correcção proposta |
|---|---|---|---|---|
| D-01 | CLAUDE §4 e AGENTS §3: `packages/paysuite` | O pacote é `packages/payments`, com Paysuite, M-Pesa, simuladores e extractos | `packages/payments/src/index.ts:1`; `AGENTS.md:130`; `CLAUDE.md:103` | Corrigir caminho e responsabilidade |
| D-02 | CLAUDE §4 coloca migrations e seed em packages/db; AGENTS usa padrão `1NNN_*.sql` | Fonte canónica em `supabase/migrations`, nomes com timestamp e sufixo; seed em `supabase/seed.sql`. Subsistem duas migrations legadas em packages/db | `.github/workflows/ci.yml:50`; `package.json:14`; inventário da secção 8 | Distinguir fonte canónica, sufixo de assunto e arquivo técnico; não mover SQL |
| D-03 | README manda abrir `/admin`; RUNBOOK indica `/admin/sistema` | O grupo Next (admin) não acrescenta prefixo: `/pedidos`, `/sistema`, etc. | `README.md:80`; `docs/RUNBOOK.md:12`; `apps/web/lib/admin/nav.ts:33` | Corrigir URLs e publicar mapa completo |
| D-04 | README descreve db:migrate como aplicar schema/seed | `db:migrate` e `db:seed` executam **supabase db reset** | `README.md:52`, `README.md:79`; `package.json:14`, `package.json:16` | Explicar reset local; separar arranque descartável de actualização incremental. Não prometer comando seguro de produção |
| D-05 | README promete bridge:dev como simulador simples | Arranca o serviço completo e usa sintaxe POSIX; a demonstração autónoma é `pnpm --filter print-bridge dev:sim` | `package.json:21`; `services/print-bridge/package.json:10`; `services/print-bridge/src/dev.ts` | Documentar modo autónomo e modo integrado, com comandos próprios para PowerShell |
| D-06 | README, onboarding e B-012 pedem Resend | ADR 0004 e transporte activo usam SMTP/nodemailer | `README.md:78`; `docs/onboarding-checklist.md:29`; `BLOQUEIOS.md:213`; `apps/web/lib/email/transport.ts` | Actualizar factos para SMTP; preservar referências históricas identificadas como tal |
| D-07 | Onboarding manda copiar brand.example.ts e editar marca em TS | Esse ficheiro não existe; marca activa vem de brand_settings/get_brand; Aparência grava update_brand | `docs/onboarding-checklist.md:12`; `apps/web/lib/brand/server.ts:43`; `apps/web/app/(admin)/aparencia/page.tsx:109` | Reescrever instalação para marca em runtime, mantendo fábrica neutra |
| D-08 | Onboarding configura operação em settings e impressão apenas por PRINTER_IP | Operação multi-loja usa stores/store_hours/delivery_zones; bridge exige também dispositivo, loja, token e origens | `docs/onboarding-checklist.md:35`; `services/print-bridge/src/config.ts:77`, `services/print-bridge/src/config.ts:85` | Usar RPCs da aba Lojas e exemplo específico do bridge |
| D-09 | Onboarding promete instalação em menos de 30 min | ROADMAP-PRODUTO P3 ainda pede instalação cronometrada, seed neutro e onboarding completo | `docs/onboarding-checklist.md:4`; `ROADMAP-PRODUTO.md` P3; `scripts/setup-client.mjs:86` | Identificar tempo como meta não verificada e listar pré-requisitos reais |
| D-10 | CLAUDE §4 enumera apenas parte das abas | Faltam Mesas, Feedback, Clientes (rota lista-espera), Aparência, POS e TVs | `apps/web/lib/admin/nav.ts:33` | Mapa das 16 abas com perfis, finalidade e links |
| D-11 | CLAUDE §14 usa parâmetro de rota [tv] | O segmento no código é [screen]; /menu e /senhas são rotas próprias; KDS não está implementado | `apps/web/app/(tv)/tv/[store]/[screen]/page.tsx:36`; `ROADMAP.md:312` | Corrigir nome do segmento e manter KDS como planeado |
| D-12 | Manual-caixa inicia sempre por email/palavra-passe | Terminal vinculado apresenta cartões e PIN; email fica como configuração/alternativa | `docs/manual-caixa.md:11`; `apps/web/app/(pos)/pos/pos-login.tsx:64`, `apps/web/app/(pos)/pos/pos-login.tsx:122` | Separar primeira configuração, início diário e troca de turno |
| D-13 | Manual-cozinha e teste 3 HARDWARE dizem comanda sempre sem preços | Talão completo em vias é o formato normal; há modelos Completo/Compacto/Cozinha, mesa e caminho offline próprios | `docs/manual-cozinha.md` §1; `docs/HARDWARE.md:167`; `packages/receipt/src/index.ts:13`; ADR 0007 | Explicar via, modelo e versão do bridge; actualizar critérios por formato |
| D-14 | HARDWARE afirma que o bridge só fala TCP e POS80 é reserva futura | Suporta destino Windows e porta série; B-006 já regista gaveta aberta pela impressora | `docs/HARDWARE.md:86`; `services/print-bridge/src/printer-target.ts`; `BLOQUEIOS.md` B-006 | Separar transportes implementados de hardware efectivamente validado por loja |
| D-15 | README bridge promete backoff 1/3/9 s e remete para talão 58 mm | Código faz três tentativas, esperas de 1 e 2 s; referência 58 mm não descreve o papel actual | `services/print-bridge/README.md:4`, `services/print-bridge/README.md:7`; `services/print-bridge/src/printer-client.ts:41` | Corrigir retentativas e ligar módulo de impressão 80 mm/modelos |
| D-16 | Descrição HTTP local omite visor | Há POST /display, além de /print, /drawer e /health | `services/print-bridge/src/local-server.ts:146` | Documentar payload, autenticação e comportamento best-effort |
| D-17 | CLAUDE/POS-DEFINICOES/manual-dono dizem refrescar POS a cada 2 min | MENU_REFRESH_MS é 15 000; ciclo também lê get_pos_settings, com refetch por realtime | `apps/web/lib/pos/offline-store.ts:19`; `apps/web/app/(pos)/pos/pos-shell.tsx:568`; `docs/POS-DEFINICOES.md:54` | Descrever cadência observada; assinalar divergência do ADR 0006 sem reescrever a decisão (V-11) |
| D-18 | CLAUDE §7.5 diz sincronizar offline por create_counter_sale | Online usa create_counter_sale; offline usa sync_counter_sale, incluindo p_local_print | `apps/web/app/(pos)/pos/pos-shell.tsx:680`, `apps/web/app/(pos)/pos/pos-shell.tsx:1617` | Documentar wrapper e supressão de papel já emitido |
| D-19 | CLAUDE §15 promete importar feedback, espera e fechos históricos | Script lê categorias, produtos, pedidos/itens e agrega customers; não implementa os outros três históricos | `scripts/import-hawsmash-1.ts:77`, `scripts/import-hawsmash-1.ts:229` | Manter requisito; marcar parcelas não implementadas. Não declarar import completo |
| D-20 | B-008 sugere envio externo bastar preencher BACKUP_TARGET | O script detecta a configuração e informa que envio externo não está implementado | `scripts/backup.mjs:61` | Distinguir dump/retenção local de transporte externo ainda em falta |
| D-21 | ROADMAP F9 mantém B-009 bloqueado por falta de chave | B-009 está explicitamente resolvido e regista importação em 31/08 | `ROADMAP.md` F9; `BLOQUEIOS.md` B-009 | Conciliar estado, preservar data/âmbito da evidência; não confirmar novamente produção por inferência |
| D-22 | BLOQUEIOS diz 16 abertos; ROADMAP-PRODUTO diz sete | Existem 37 entradas B-*, duas marcadas resolvidas e **35 com estado aberto no texto** | `BLOQUEIOS.md:578`; `ROADMAP-PRODUTO.md:78` | Uma contagem actual derivada das entradas; pacotes antigos datados/arquivados |
| D-23 | B-110 diz SQL/PIN nunca ensaiados; PLANO-LIVE diz “fechado” | PLANO-LIVE regista 11/11 em staging, mas no mesmo documento mantém entrada real no terminal pendente | `docs/PLANO-LIVE.md:120`; `BLOQUEIOS.md` B-110 | Separar SQL validado de login humano pendente; não fechar tudo |
| D-24 | B-022 ainda afirma produção segue dev | ROADMAP e ANALISE-ORIGENS-UPSELL registam correcção do trigger para main em 24/09 | `BLOQUEIOS.md` B-022; `docs/ANALISE-ORIGENS-UPSELL.md` Publicação | Actualizar a parcela documentada como resolvida; configuração/DNS restantes precisam de evidência própria |
| D-25 | Spec local pública manda marca em config/brand.ts, diz conta inexistente e entrada /→/menu | Entrada escolhe loja; /menu redirige; checkout usa conta por cookie; marca lê getBrand | `apps/web/app/(public)/CLAUDE.md:8`, `apps/web/app/(public)/CLAUDE.md:90`, `apps/web/app/(public)/CLAUDE.md:204`; `apps/web/app/(public)/menu/page.tsx:23`; `apps/web/app/api/account/route.ts:17` | Consolidar site/conta/aparência nos módulos; manter regras locais essenciais e apontadores |
| D-26 | Spec local cita /layout-loja e /api/upload-storefront-asset | Não há essas rotas; Aparência faz upload brand-assets, PromoSection usa storefront-assets | `apps/web/app/(public)/CLAUDE.md:225`, `apps/web/app/(public)/CLAUDE.md:270`; `apps/web/app/(admin)/aparencia/page.tsx:357` | Retirar referências como interfaces actuais, sem prometer editor livre de layouts |
| D-27 | Spec local limita carrinho a menuItemId/qty/notes | Contrato também transporta variante, adicionais, modificadores e atribuição de upsell | `apps/web/app/(public)/CLAUDE.md:58`; `apps/web/utils/useCart.ts:26` | Documentar contrato efectivo, preservando regra de preço no servidor |
| D-28 | Spec local descreve MenuExperience/WaitlistForm como montra em uso | MenuExperience está sem importador actual; /l renderiza Storefront | `apps/web/app/(public)/menu/menu-experience.tsx:113`; `apps/web/app/(public)/l/[slug]/page.tsx:35` | Identificar componente herdado sem percurso activo; não confundir ficheiro existente com funcionalidade entregue |
| D-29 | PREPARACAO-VOLUME ainda lista paginação de exportação por fazer | Exportação actual pagina 500 registos, detecta inconsistências e limita período/volume explicitamente | `docs/PREPARACAO-VOLUME.md` tabela inicial; `apps/web/app/api/reports/export-sales/route.ts`; `docs/EXPORTACAO-CONTABILIDADE.md` | Marcar implementação local entregue; manter capacidade e ensaio real separados |
| D-30 | RUNBOOK/manuais dizem que digest/alertas acontecem automaticamente | Existem handlers; não existe agendamento no repo. B-106/B-114 mantêm scheduler pendente | `apps/web/app/api/cron`; `railway.json`; `BLOQUEIOS.md` B-114 | Indicar dependência de scheduler, credencial, SMTP e validação de recepção |
| D-31 | menu-format cita packages/core/money.ts | O ficheiro está em packages/core/src/money.ts; importador chama import_menu | `docs/menu-format.md:41`; `scripts/import-menu.ts:71` | Corrigir caminho; explicar executor de serviço e contrato legado da RPC |
| D-32 | turbo ainda enumera variáveis Resend | Transportes actuais usam SMTP e há novas famílias de configuração fora de globalEnv | `turbo.json:11`; `apps/web/lib/email/transport.ts`; secção 9 | Registar configuração/cache a rever em tarefa de código; não alterar JSON nesta corrida |
| D-33 | Descrição genérica do core sugere máquina/schemas como contrato activo único | transition e schemas públicos herdados não são usados pelos fluxos web; RPCs e validação própria implementam o contrato actual | `packages/core/src/order-machine.ts:27`, `packages/core/src/schemas.ts`; `apps/web/app/api/payments/route.ts:86` | Mostrar consumidores efectivos e divergências, sem declarar equivalência TS/SQL |
| D-34 | Leitura de “testes verdes” pode sugerir cobertura DB e todos os e2e | pnpm test exclui packages/db/tests; CI chama gate DB separado e Playwright padrão exclui quatro suites dedicadas | `vitest.config.ts:14`; `.github/workflows/ci.yml:65`; `playwright.config.ts:6` | Documentar matriz comando→âmbito→dependências→limites |
| D-35 | ROADMAP F1 declara tipos regenerados, sem indicar desfasamento posterior | types.ts descreve 42 tabelas public, contra 51 na cadeia actual; faltam nove tabelas e RPCs recentes | `packages/db/src/types.ts:41`; inventário SQL da secção 8 | Identificar a versão parcial dos tipos; regeneração é tarefa de código posterior, não executada aqui |

## 3. Lacunas: código presente e documentação insuficiente

“Sem documento de módulo” não significa “nunca mencionado”: mesas, fecho do dia, artigos vendidos, alteração de pedidos e resumo mensal já aparecem na spec, no roadmap ou nos bloqueios. Não se deve apagar essa evidência nem anunciar essas funcionalidades como descobertas sem qualquer registo anterior.

| Assunto | O que falta reunir / facto sem explicação operacional central | Fonte |
|---|---|---|
| Mesas | QR + balcão na mesma conta, dia de Maputo, nome da conta, repartição de pagamentos, concorrência, limite da anulação e avisos no fecho | RPCs 1081/1092; `apps/web/lib/pos/tables.ts`; testes mesas |
| Caixa | Distinção turno/dia, períodos, contagens, lista sold congelada, compatibilidade bridge antigo, destinatário e autorização de PDF/email | 1091/1095; `apps/web/lib/cash`; `packages/receipt/src/cash-day.ts` |
| Pedidos | Máquina SQL efectivamente usada, wrappers históricos, edição de morada/hora, estados por canal e papéis | 1062/1072/1081; core herdado não é prova de equivalência |
| Perfis | Matriz de navegação **versus** permissões de BD/API; cozinha sem KDS; Clientes/Marketing visíveis a gerente com restrições de dados diferentes | `apps/web/lib/admin/nav.ts`; policies/RPCs |
| Equipa/PIN | Cartões, vinculação do terminal, travão de tentativas, criação de sessão pessoal e alternativa por email | `apps/web/app/api/pos/login/route.ts`; migration 1049 |
| Pagamentos | Um contrato reunindo Paysuite, M-Pesa directo, e-Mola preparado, manual, idempotência, resultados incertos, consulta e reconciliação | `packages/payments`; `apps/web/lib/payments`; EMOLA-ONLINE e PREPARACAO-VOLUME hoje dispersos |
| Conta do cliente | Fluxo efectivo no checkout, cookie, moradas/códigos/revogação, ausência de componente de conta dedicado e pressuposto de posse violado | ADR 0003; `apps/web/app/api/account`; V-01 |
| API HTTP | Catálogo completo de métodos, credenciais, chamadas RPC, respostas/falhas e chamadas sem guard | Secção 7.3; não existe referência única |
| Crons | Quais existem, autorização desigual, continuidade por cursor, timeout, reenvio mensal e quem os agenda | Secção 7.4 |
| Eventos | Catálogo consolidado de produtores, actor/store, payload mínimo, eventos empresariais e efeitos best-effort | SQL, handlers de cron, pagamentos e conversões |
| Impressão/visor | Claim da fila, ledger em disco, limites de retry/crash, TCP/Windows/série, layout/payload/bytes e versão mínima | `services/print-bridge/src`; `packages/receipt/src` |
| Build/testes | Pacotes com build apenas echo, saídas Turbo, quatro configs e2e dedicadas, gates de BD e pré-requisitos Windows | Secção 10 |
| Configuração | Seis variáveis consumidas ausentes dos dois exemplos; requisitos próprios do bridge | Secção 9 |
| Resumo mensal/Google | Contrato da fotografia, diferença entre reviews actuais e métricas GBP ainda ausentes, deduplicação e force | Código preexistente não commitado; B-114 |

Não há, no conjunto actual, índices gerais de documentação e de ADRs, catálogo completo de RPCs, matriz de todas as tabelas/RLS, índice integral de migrations ou catálogo de eventos. As referências existentes são parciais ou orientadas a uma entrega.

## 4. Documentado mas ausente, legado ou ainda planeado

| Elemento | Classificação correcta |
|---|---|
| packages/paysuite, config/brand.example.ts, /admin, /admin/sistema, /layout-loja, /api/upload-storefront-asset | Caminhos/interfaces actuais inexistentes; ver D-01/D-03/D-07/D-26 |
| KDS /kds/[store] | Planeado em G2, sem página implementada; não equiparar quadro POS ou TV a KDS |
| Chat guiado/humano, chat_threads/chat_messages/chat_topics | Spec de futuro em CLAUDE §19/B-021, sem implementação/migrations. O verificador futuro precisa de excepção explícita “planeado” |
| Cópia integral de loja | ADR 0002 aceite e adiado; copiar definições POS não entrega esta decisão |
| e-Mola directo real | Adapter/contrato Movitel ausentes; simulador e guardas existem. Não é só preencher uma chave |
| Transporte externo de backup, scheduler de crons, restauro real | Não comprovados pelo código; backup externo ainda sem implementação no script |
| Importação de feedback/lista de espera/fechos do 1.0 | Requisito que o script não satisfaz; não renomear como concluído |
| client:update, painel de frota, instalação neutra cronometrada | Roadmap de produto, não capacidades entregues |
| funnel_rates/funnel_by_source | Views removidas pela 1066; referência actual deve apontar analytics_sessions/online_analytics_events |
| MenuExperience e componentes associados | Código herdado sem ligação à montra activa; existência não demonstra percurso utilizável |
| “RPC pública” só por estar no schema public | Vários helpers/overloads legados têm EXECUTE revogado para browsers; ver secção 8 |
| Nomes de ficheiros antigos em relatos de migração | História intencional; não aplicar substituição cega a todos os backticks |

## 5. Código que viola a spec

**Não corrigido nesta tarefa.** As conclusões seguintes têm suporte no código versionado/árvore local. A prioridade indica impacto potencial, não exploração ou incidente confirmado. A remediação de comportamento/schema precisa de tarefa própria e, para SQL, nova migration.

| ID / prioridade | Regra preservada | Evidência e contradição |
|---|---|---|
| V-01 · alta | ADR 0003: telefone sozinho não permite obter moradas; vinculação pressupõe posse do pedido | `supabase/migrations/20260831190000_1038_normalizar_telefone_cliente.sql:238` e `:262` devolvem IDs de pedidos por telefone em identify_customer/get_customer_orders, concedidas a anon. `supabase/migrations/20260831140000_1034_conta_do_cliente.sql:193` aceita esse ID sem prova adicional e devolve token/perfil/moradas. `apps/web/app/api/account/route.ts:55` expõe bind por orderId; `apps/web/utils/supabase/server.ts:10` usa service role. A cadeia permite transformar o identificador público em sessão de conta. Não foi exercitada contra cliente real |
| V-02 · alta | CLAUDE §1 regra 3 / ADR 0001: isolamento por loja | `supabase/migrations/20260614000002_storage.sql:19` mantém payment_proofs_authenticated_all com filtro apenas bucket_id. Não há substituição posterior por escopo de loja. Um authenticated tem policy de leitura/escrita/apagamento de comprovativos das outras lojas; bucket privado e URL assinada não substituem esse filtro |
| V-03 · alta | CLAUDE §6: kitchen não vê dinheiro | `supabase/migrations/20260819144028_1004_staff_rls.sql:243` e `:349` permitem leitura de orders/order_items/print_jobs da loja, incluindo valores e payloads. A 1017 protege cash_sessions/cash_movements/payments, mas não estas colunas; `supabase/migrations/20260913225235_1045_paginacao_pedidos.sql:57` devolve valores em get_orders. Guard visual do painel não protege acesso directo/RPC |
| V-04 · alta | CLAUDE §6/§10: preço/stock manual sempre auditados; movimentos de stock registados | `supabase/migrations/20260819144024_1003_store_items.sql:20` e `supabase/migrations/20260819144028_1004_staff_rls.sql:256`, `:400` mantêm INSERT/UPDATE directo de store_items para owner/manager. Pode alterar stock_qty/price_cents_override fora das RPCs com event_log/stock_movements; não foi encontrado trigger que audite essa escrita directa |
| V-05 · alta, alcance condicionado | ADR 0001: store_id obrigatório salvo tráfego pré-loja; isolamento operacional | `supabase/migrations/20260828140000_1029_atribuicao_multi_fonte.sql:48`/`:85` e `supabase/migrations/20260828160000_1030_fila_de_conversoes.sql:42`/`:72` permitem store_id nulo e leitura quando é nulo, a qualquer authenticated. Os produtores normais preenchem loja; **não se observou linha nula real**. A policy e o schema deixam a excepção mais aberta que a regra |
| V-06 · média | CLAUDE §5.1/§5.6: operação da loja em stores; settings.accepting_orders não deve fingir fechar loja | `apps/web/app/(admin)/settings-section.tsx:46` ainda grava pagamentos, morada, horário e accepting_orders em settings; `:119` mostra esse estado como aberto/fechado. `apps/web/app/(admin)/layout.tsx:83` também lê o singleton. O modal aponta para Lojas, mas o indicador continua contraditório |
| V-07 · média | CLAUDE §1/§17: dinheiro sem float | `packages/core/src/money.ts:11` usa parseFloat e Math.round na conversão; usado por `packages/core/src/menu-import.ts:112`. A leitura prova uso de float/aceitação de prefixo numérico, não um erro de cobrança já ocorrido |
| V-08 · média | AGENTS §2/§5 e CLAUDE §17: formatMT, nunca Intl currency MZN | `apps/web/app/api/emails/send-approval-email/route.tsx:23` e `apps/web/app/api/attach-proof/route.ts:27` dividem centavos e usam Intl com MZN em emails |
| V-09 · média | AGENTS §1.5: guarda de PLACEHOLDER_ ligada ao build de produção | `scripts/check-placeholders.mjs` existe e consulta três tabelas, mas não é chamado pelos scripts build, Railway ou CI. Teste puro do detector não prova que o build bloqueia uma instalação com placeholders |
| V-10 · média | CLAUDE §17/§18.3: identidade do cliente fora de caminhos/variáveis/código do produto | `services/print-bridge/windows/build-sea.ps1:19` e `windows/install-task.ps1:3` fixam nome de executável/tarefa com identidade do cliente; `scripts/lib/backup-plan.mjs:8` fixa-a no rótulo de backup. O teste de conteúdo cobre TS/TSX/CSS, não scripts PowerShell |
| V-11 · baixa | ADR 0006: leitura de definições do POS a cada 2 min | `apps/web/lib/pos/offline-store.ts:19` e `apps/web/app/(pos)/pos/pos-shell.tsx:568` fazem leitura a cada 15 s. Decisão original não será reescrita; é necessário reconciliar implementação e decisão |
| V-12 · média | CLAUDE §3: Zod em todas as boundaries | Três handlers send-order/approval/rejection-email lêem JSON com verificações de campos em vez de schema; `apps/web/app/api/emails/send-order-email/route.tsx:13` aceita destinatário/assunto/HTML do caller. Também não têm guard de autorização; ver R-01 |
| V-13 · alta | CLAUDE §1 regra 4: operações de dinheiro idempotentes | `supabase/migrations/20260819220000_1007_cash.sql:204` define add_cash_movement sem chave de pedido; `:250` insere sempre uma nova linha. cash_movements não tem unicidade de retry. Repetir a mesma sangria/reforço após resposta incerta volta a contabilizá-la; não depende de a UI fazer retry automático |
| V-14 · alta | CLAUDE §6/§7.4: cozinha só avança preparo; anulação de venda exige manager/owner | `supabase/migrations/20260923140000_1062_comanda_padrao_em_todos_os_canais.sql:163` verifica acesso à loja e delega em advance_order_legacy. `supabase/migrations/20260819231000_f6_stock_consumption.sql:507` e `:533` aceitam APPROVE/CANCEL sem auth_role. Cozinha pode aprovar/cancelar por RPC; caixa pode contornar a restrição de void_sale por CANCEL |
| V-15 · alta | CLAUDE §17: não confiar no cliente para estado de pagamento | `supabase/migrations/20260923140000_1062_comanda_padrao_em_todos_os_canais.sql:205` e `:236` autorizam confirm_payment a authenticated com acesso ao pedido. O legado em `supabase/migrations/20260819231000_f6_stock_consumption.sql:633` recebe provider/ref/montante do caller e confirma ao coincidir o total. Um staff da loja pode chamar a RPC sem verificação de gateway. O HMAC do handler HTTP não protege a chamada directa à RPC |
| V-16 · alta | CLAUDE §1/§8: papel best-effort não reverte a venda | No online, `supabase/migrations/20260923140000_1062_comanda_padrao_em_todos_os_canais.sql:174` e `:227` chamam enqueue_kitchen_tickets sem bloco de excepção; o legado também insere print_jobs dentro da transacção. Erro SQL na preparação do papel reverte aprovação/confirmação. Isto é diferente de falha física da impressora, que continua assíncrona; o POS tem protecção própria |

Nos nomes abreviados de migration desta secção, o ficheiro completo correspondente está no inventário do anexo A. Os sufixos são únicos no retrato auditado.

### Riscos e limitações que não se devem disfarçar de factos corrigidos

| ID | Evidência | Limite / acção futura |
|---|---|---|
| R-01 | As três rotas de email acima não autenticam a chamada e aceitam destinatário/conteúdo; middleware só trata atribuição/cookies | Potencial abuso de SMTP; nenhuma mensagem foi enviada para testar. Documentar permissões reais e tratar autorização numa tarefa de código |
| R-02 | Crons alerts/conversions/digest só verificam Bearer quando CRON_SECRET está preenchido; monthly/reconcile recusam configuração ausente | Catálogo deve mostrar diferença; não afirmar que todos são protegidos ou que há segredo no deploy |
| R-03 | Login/browser usa supabase-js com persistência local; PDF/emails de caixa lêem sessão por cookies e callers não enviam Bearer | Incompatibilidade estática em `apps/web/lib/cash/server-client.ts:4`, `apps/web/app/(admin)/caixa/page.tsx:204` e `apps/web/app/(pos)/pos/caixa-tab.tsx:299`. **Não foi observado 401 em runtime**; comparar com exportação que usa Bearer |
| R-04 | Importador promete --i-know-this-is-live no comentário, mas parser só verifica --apply/--store; apaga order_items antes de inserir novamente | `scripts/import-hawsmash-1.ts:7`, `:33`, `:221`. Sem guarda efectiva de produção nem transacção entre delete/insert; erro do delete ignorado. Não executar baseado no comentário |
| R-05 | Ledger local é persistido após imprimir; fila marca printed depois de enviar bytes | `services/print-bridge/src/local-server.ts:98`; `request-ledger.ts:39`; `polling.ts:74`. Retry normal é deduplicado; crash após papel e antes da confirmação pode duplicá-lo. Não prometer “exactamente uma impressão” em qualquer falha |
| R-06 | UI permite manager em Clientes/Marketing, mas customers é owner-only e customer_addresses não tem grants directos; settings também restringe escrita | Diferenciar acesso à aba de capacidade efectiva. É preciso ensaio de perfil; não alargar policy para fazer o doc parecer certo |
| R-07 | Uso de variáveis actuais fora de turbo.globalEnv; pacotes têm builds placeholder | Risco de ambiente/cache/empacotamento, sem falha de deploy observada. Documentar até existir correcção validada |
| R-08 | order_feedback/referral_redemptions obtêm loja por join; catálogo, conta, marca e biblioteca de media têm âmbito de empresa | A spec literal “toda a linha operacional tem store_id” não é descrição completa do schema. Documentar a excepção observada e submetê-la à decisão; não alegar fuga por ausência da coluna apenas |

## 6. Duplicação e casa única proposta

| Assunto | Onde está hoje | Casa principal proposta |
|---|---|---|
| Regras de produto/arquitectura | CLAUDE raiz, CLAUDE público, engine, ROADMAP-PRODUTO | CLAUDE raiz enxuto + ADRs; engine conserva história |
| Arranque | README, onboarding, README bridge, PLANO-LIVE | README para dev; operacao/instalacao para instalação; bridge README como entrada local |
| POS | CLAUDE §7, POS-DEFINICOES, manual-caixa, instruções datadas, roadmap | modulos/pos; manual por tarefa em operacao/manual-caixa |
| Talão/bridge/visor | CLAUDE §8, POS-DEFINICOES §11, HARDWARE, README bridge | modulos/impressao; hardware separado em operacao |
| Pedidos/pagamentos/stock/caixa | CLAUDE `9–12, roadmap, docs e-Mola/volume/exportação | Um módulo por domínio; referência técnica por objecto |
| Loja/brand/equipa | CLAUDE `5/6/18, ROADMAP-PRODUTO, onboarding | modulos/lojas, aparencia, equipa; decisões mantidas na spec/ADRs |
| Tracking/marketing/upsells | RASTREIO, marketing-setup, ANALISE-ORIGENS-UPSELL, CLAUDE público, engine | modulos/marketing; manual de activação em operacao/marketing |
| Relatórios/exportação/Google | ANALISE-DESIGN, EXPORTACAO-CONTABILIDADE, roadmap, B-114 | modulos/relatorios; base visual em desenvolvimento/analise-interface |
| Agentes | MCP, plugin README, ADR 0005, roadmap | modulos/agentes para funcionamento; plugin README mantém empacotamento local e links |
| Validação/estado de entrega | ROADMAP, BLOQUEIOS, PLANO-LIVE, validation, instruções datadas | Roadmaps mantêm história de execução; bloqueios actuais no topo; evidência datada em validation/historico |
| Planos de capacidade | PREPARACAO-VOLUME e roadmap | planos/volume, distinguindo critérios de aceitação de capacidade medida |
| Catálogos técnicos | Listas parciais em todos os anteriores | referencia: migrations, RPCs, tabelas/RLS, rotas, env, crons, eventos, testes |

## 7. Inventário da aplicação

### 7.1 Painel: as 16 abas

O = owner; M = manager da loja; C = cashier. A tabela descreve **guard de navegação**, não autorização irrestrita da BD. Fonte comum: `apps/web/lib/admin/nav.ts:33` e layout do painel. Kitchen é recusado neste painel.

| Rota / aba | Perfis UI | Função e principais acessos |
|---|---|---|
| /pedidos | O/M/C | Quadro paginado, filtros, conciliação needs_review, comprovativo assinado, advance_order e reprint |
| /cardapio | O/M | Catálogo/variantes/adicionais, store_items, fotos menu-photos; CRUD directo em várias tabelas. O suporte a modificadores na BD/site não implica editor nesta aba |
| /mesas | O/M | CRUD tables por loja e QR /m/[token]; não é a conta/pagamento do POS |
| /caixa | O/M/C | get_cash_dashboard, abrir/fechar turno, movimentos, PDF/email; lista de cash_day_closes |
| /estoque | O/M | Produtos, ingredientes, movimentos, fichas e CMV; custo/ficha editáveis pelo O |
| /analise | O/M | Vendas Todos/Online/POS, aquisição, atribuição, upsells, exportação |
| /feedback | O/M | admin_list_feedbacks |
| /lista-espera — Clientes | O/M | Pesquisa/paginação customers, moradas e histórico; restrições efectivas em R-06 |
| /marketing | O/M | IDs/tokens e configuração; limitações de escrita de settings em R-06 |
| /lojas | O/M | O configura loja, horário, zonas/pagamento; M opera kill switch; Google Place ID no trabalho local |
| /definicoes-pos — POS | O/M | get/save_pos_settings, meios de pagamento/upsell/notas, layout/vias, copiar definições |
| /tvs | O/M | store_tvs, biblioteca tv_media, save/delete_store_tv, register/delete_tv_media |
| /equipa | O | Contas, perfil/lojas/PIN, revogação, password via API |
| /aparencia | O | get_brand/update_brand e assets da identidade |
| /sistema | O/M | get_system_status/list_system_alerts/get_conversion_health |
| /definicoes | O | SettingsSection/PaysuiteSection/PromoSection; campos herdados ainda presentes (V-06) |

Todas são `page.tsx` sob `apps/web/app/(admin)`. As páginas cardapio/mesas/marketing/definicoes delegam em componentes *-section.tsx do grupo. Não existe uma página separada /clientes.

### 7.2 Restantes 14 páginas

| Rota | Público/perfil | Percurso / fonte |
|---|---|---|
| / | anon | Escolha de loja; `apps/web/app/(public)/page.tsx:32` |
| /l/[slug] | anon | Storefront da loja, /api/menu; `apps/web/app/(public)/l/[slug]/page.tsx:35` |
| /menu | anon | Redirect por hs_store/loja por omissão; `apps/web/app/(public)/menu/page.tsx:23` |
| /upsell | anon | Ofertas de upgrade/companhia; página pública upsell |
| /checkout | anon + conta opcional por cookie | Menu, dados/horário/zona, conta/moradas, pagamento e comprovativo |
| /order-status/[orderId] | portador de UUID | Estado, polling, bind de conta e feedback; pressuposto de posse em V-01 |
| /payment/return/[orderId] | portador de UUID | Consulta/retorno de pagamento e encaminhamento para estado |
| /m/[token] | portador de token da mesa | get_table_by_token, menu dine_in, pedido QR na loja da mesa |
| /pedido-assistido | anon | Revê fragmento preparado por agente; só substitui carrinho após confirmação humana |
| /tv/[store]/menu | anon | get_store_board, actualização 60 s |
| /tv/[store]/senhas | anon | get_store_queue, polling 5 s |
| /tv/[store]/[screen] | anon | get_tv_screen/config 30 s, heartbeat, cache de media, auto-update |
| /pos | staff + terminal/PIN | Venda, pedidos/delivery, senhas, mesas, caixa e disponibilidade; backend aceita kitchen em login, ver V-03 |
| /login | público, cria sessão staff | signInWithPassword e redirect interno validado |

Não há rota cron de página: os cinco crons são endpoints HTTP. Não há rota KDS.

Além destas páginas/APIs, `apps/web/app/manifest.ts:7` serve a rota especial **/manifest.webmanifest**, com scope/start_url do POS. O service worker `apps/web/public/pos-sw.js` é um asset estático.

### 7.3 Todos os 34 endpoints HTTP

Prefixo comum **/api**; ficheiro correspondente em **apps/web/app/api**. Os três emails legados têm `route.tsx`; os outros usam `route.ts`. “Público” descreve ausência de login de staff, não autorização para uma instalação aceitar qualquer efeito.

| Endpoint | Método(s) | Porta de entrada / efeito |
|---|---|---|
| /account | GET, POST | Cookie hs_acc para ler/sair; bind por orderId sem prova adicional (V-01) |
| /account/address | POST, DELETE | Cookie/token; account_save_address/account_delete_address |
| /account/code | POST | Telefone/código; account_request_code/account_verify_code |
| /agents/tools | POST, OPTIONS | Flag/origem/limites; ferramentas públicas sem criar pedidos |
| /attach-proof | POST | UUID/path → attach_payment_proof; aviso ao dono best-effort |
| /cash-sessions/[id]/report | GET | Sessão por cookie e RLS → PDF |
| /conversions/fire | POST | Público; contexto/conversões server-side; rever autorização/contrato no módulo |
| /create-order | POST | Público; create_order + atribuição server-side |
| /cron/alerts | GET | Bearer condicional → consulta alertas/email |
| /cron/conversions | GET | Bearer condicional → outbox de conversões |
| /cron/digest | GET | Bearer condicional → digest diário |
| /cron/monthly | GET | Bearer obrigatório → resumo mensal/Google; ficheiro local preexistente não commitado |
| /cron/reconcile | GET | Bearer obrigatório → consulta pagamentos por loja/cursor |
| /emails/send-approval-email | POST | Payload caller, sem autenticação; SMTP (V-08/V-12/R-01) |
| /emails/send-order-email | POST | Destinatário/assunto/HTML caller, sem autenticação (R-01) |
| /emails/send-rejection-email | POST | Payload caller, sem autenticação (R-01) |
| /emails/send-cash-close-email | POST | Sessão cookie/RLS; destinatário e relatório do servidor |
| /emails/send-cash-day-email | POST | Sessão cookie/RLS; destinatário e relatório do servidor |
| /feedback | POST | Público; submit_feedback |
| /health | GET | Público; disponibilidade HTTP, não prova ponta a ponta |
| /mcp | POST, GET, DELETE, OPTIONS | SDK Streamable HTTP, flag/origem/limites; ver ADR 0005 |
| /menu | GET | Público; get_menu por loja/canal |
| /order-status/[orderId] | GET | Público por UUID; get_order_status |
| /payments | POST | Público; create_order, claim_online_checkout e fornecedor da loja/método |
| /payments/verify | POST | UUID → consulta fornecedor/confirmador comum |
| /pos/login | POST | Dispositivo/cartão/PIN, Zod e travão BD; emite sessão pessoal Supabase |
| /reports/export-sales | GET | Bearer/getUser; RPC sob identidade do utilizador, O/M e consolidado só O |
| /staff | POST | Bearer + owner activo; cria acesso por Admin Auth |
| /staff/[userId]/password | PATCH | Bearer + owner activo; reset e auditoria |
| /stores | GET | Público; list_public_stores |
| /track | POST | Validação manual/bots/sessão/atribuição; analytics_events server-side. Consentimento de marketing é tratado no cliente |
| /version | GET | Público; versão de build para actualização de terminais |
| /waitlist | POST | Público; join_waitlist |
| /webhooks/paysuite | POST | HMAC e confronto de referência/valor/método/pedido; confirmador comum |

Fonte da autorização de staff: handlers staff/export; o middleware da aplicação trata atribuição e cookies de medição, **não é um guard de autenticação global**. Os handlers públicos legados usam cliente servidor com service role; o canal de agentes usa anon, sem cookies, como exige o ADR 0005.

### 7.4 Crons: código não é scheduler

| Handler | Protecção observada | Comportamento / dependência |
|---|---|---|
| alerts | Só valida Bearer se CRON_SECRET existir | Cooldown 30 min; list_system_alerts_all; SMTP/WhatsApp deep link |
| conversions | Só valida Bearer se CRON_SECRET existir | Claim/processamento da outbox; credenciais de cada rede |
| digest | Só valida Bearer se CRON_SECRET existir | get_daily_digest, resumo diário/email |
| monthly | Recusa ausência de CRON_SECRET (503) | get_monthly_digest, fotografia Google, deduplicação/force; B-114 |
| reconcile | Recusa ausência de CRON_SECRET (503) | Até 300 pedidos por passagem, páginas de 50, 3 consultas em paralelo, orçamento 50 s/consulta 20 s; nextCursor até completed; B-106 |

Não há `cron.schedule` nas migrations nem agendador em `railway.json`. Horários indicados nos docs são configuração desejada, não prova de execução.

## 8. Inventário da base de dados

### 8.1 Cobertura e método

Foram inventariadas as **149 migrations, 33 732 linhas**: 42 de Junho, 63 de Agosto, 44 de Setembro. Os nomes completos constam do anexo A. Há ainda duas migrations legadas em `packages/db/migrations`, que não são a cadeia canónica usada pelo CI.

A leitura seguiu CREATE/ALTER/RENAME/SET SCHEMA/DROP, grants/revokes e redefinições posteriores. O levantamento estático encontra **314 declarações CREATE FUNCTION e 203 assinaturas finais**: **124 public + 79 private**, **173 SECURITY DEFINER + 30 invoker**. Isto não é introspecção da instalação: renames condicionais dependem de precondições e a 1080 altera corpos por pg_get_functiondef/replace/EXECUTE. Não se usou apenas a primeira definição ou uma pesquisa de “using true” para concluir permissões.

### 8.2 Tabelas, âmbito e RLS

**52 tabelas declaradas**: 51 public e uma private. Há ENABLE ROW LEVEL SECURITY para todas na cadeia; não foi encontrado DISABLE. RLS ligada não significa policy correcta, grants seguros ou instalação migrada.

| Âmbito | Tabelas | Modelo observado |
|---|---|---|
| store_id obrigatório — 24 public | delivery_zones, orders, order_items, cash_sessions, payments, print_jobs, tables, store_hours, order_counters, store_items, staff_stores, devices, cash_movements, stock_movements, store_order_sequences, store_ingredients, ingredient_movements, store_campaigns, store_pos_settings, order_upsells, table_bills, store_tvs, cash_day_closes, google_profile_snapshots | Loja directa; helpers auth_can_store e grants/RPCs específicos. Tables tornou-se multi-loja na 1081; snapshot Google pertence ao trabalho local |
| store_id obrigatório — private | order_upsell_captures | Captura interna idempotente, não endpoint do browser |
| store_id nullable — 4 public | analytics_events, event_log, order_attribution, conversion_jobs | Tráfego/actos de empresa e atribuição/conversões. Event_log admite empresa com leitura owner; V-05 distingue policies dos dois últimos |
| Entidade/definições de empresa | stores, settings, brand_settings | Stores identifica a própria loja; settings/brand_settings são singletons. Segredos têm grants/RPCs específicos |
| Catálogo partilhado | menu_categories, menu_items, menu_item_variants, menu_addons, menu_modifier_groups, menu_modifier_options, ingredients, recipe_items | Sem store_id por desenho; realidade física nas tabelas store_* |
| Identidade/equipa | staff_profiles | Associação a loja em staff_stores; não confundir perfil com sessão Auth |
| Clientes/dispositivos de conta | customers, customer_addresses, customer_devices, customer_login_codes | Customers owner-only; tabelas de conta sem leitura directa anon/authenticated, acesso por token/RPC |
| Associadas ao pedido | order_feedback, referral_redemptions | Loja obtida por join a orders; não têm a coluna literal |
| Outros globais/herdados | referral_codes, waitlist, rate_limits, device_heartbeats, tv_media | Policies diferentes: owner-only em vários legados; tv_media é biblioteca partilhada O/M; não tratar todas como operação isolada por coluna |

Ver V-02 a V-05 antes de usar esta matriz como declaração de segurança.

### 8.3 Catálogo funcional das assinaturas public

O catálogo abaixo inclui os nomes por domínio; **nome em public não significa EXECUTE permitido ao anon**. As famílias da aplicação usam DEFINER salvo excepções indicadas. Quem chama está identificado na secção 7 e no mapa de pacotes. Funções service-only não devem ser documentadas como contratos de browser.

| Domínio / consumidores | Funções |
|---|---|
| Lojas e catálogo — público/painel | list_public_stores, get_menu; get_store_admin, save_store, set_store_hours, save_delivery_zone, delete_delivery_zone, set_store_accepting_orders; get_store_payment_status, save_store_payment; get_brand, update_brand; get_pos_settings, save_pos_settings, set_store_ticket_copies; start_store_campaign, set_item_availability, set_store_google_place |
| Pedidos/pagamentos — checkout, painel, server | create_order, get_order_status, get_orders, get_order_stats, advance_order, confirm_payment, attach_payment_proof, ensure_payment_reference, claim_online_checkout, void_sale, update_order_details |
| POS/mesas | create_counter_sale, sync_counter_sale, bind_pos_device, set_own_pos_pin, lock_pos_device, unlock_pos_device, pos_pin_status, pos_login_cards, pos_login_with_pin, call_ticket, launch_table_order, close_table_bill, pos_table_overview, get_table_by_token |
| Caixa/exportação | open_cash_session(uuid,integer), add_cash_movement, close_cash_session(uuid,integer,text), get_cash_dashboard(uuid), get_cash_day, close_cash_day, export_sales_for_accounting |
| Papel/dispositivos | reprint, open_cash_drawer, bridge_heartbeat, recover_stale_print_jobs, get_device_status |
| Equipa/sistema/crons | list_staff, set_staff_access, deactivate_staff, set_staff_pin, get_system_status, list_system_alerts, list_system_alerts_all, audit_permissive_policies, get_daily_digest, get_monthly_digest |
| Stock/ficha/CMV | adjust_store_stock, set_stock_tracking, list_store_stock, list_stock_movements, list_stock_alerts, save_ingredient, save_recipe_item, delete_recipe_item, list_recipes, list_store_ingredients, adjust_store_ingredient, set_ingredient_tracking, list_ingredient_movements, report_cmv |
| Cliente/referral/feedback | identify_customer, get_customer_orders, account_request_code, account_verify_code, account_bind_device, account_me, account_logout, account_save_address, account_delete_address, submit_feedback, join_waitlist, admin_list_feedbacks, admin_list_waitlist, validate_referral |
| Analítica/conversões | get_attribution_report, get_sales_metrics, get_dashboard_metrics, get_funnel_metrics, get_upsell_metrics, enqueue_conversions, record_server_purchase_event, claim_conversion_jobs, complete_conversion_job, get_conversion_health, record_order_attribution, get_conversion_context |
| TVs | get_store_board, get_store_queue, save_store_tv, delete_store_tv, register_tv_media, delete_tv_media, get_tv_screen |
| Legado/helpers mantidos, revogados a browsers | _confirmed_orders_in_period, adjust_stock, open_cash_session(), close_cash_session(integer,text), import_menu, get_secret_settings, upsert_heartbeat, create_counter_sale_unlocked, create_counter_sale_without_drawer, create_counter_sale_without_recipe, create_counter_sale_without_tickets |
| Trigger public | trigger_set_available_on_stock |

Entre as excepções **invoker** relevantes estão get_orders/get_order_stats, get_device_status, list_recipes, admin_list_feedbacks/admin_list_waitlist, get_dashboard_metrics/get_funnel_metrics e trigger_set_available_on_stock. A Fase 3 deve publicar assinatura, SECURITY, grants e fonte final por linha, e não inferir “público” a partir do schema.

Cadeias que exigem atenção especial: get_menu recebe wrappers de campanha/e-Mola/fotos; create_counter_sale combina venda, gaveta, receitas, vias e upsell; create_order combina loja/campanha/checkout/upsell/mesas. A função mais recente delega em predecessoras privadas: a data da última declaração não resume toda a regra.

### 8.4 Helpers private — 79 assinaturas

| Família | Nomes |
|---|---|
| Autorização/contexto | auth_role, auth_is_owner, auth_can_store, auth_default_store_id, request_store_id, can_access_order, enforce_order_store_id, enforce_event_context, assert_staff_admin, assert_stock_manager, assert_recipe_owner, secret_hash |
| Wrappers preservados | advance_order_legacy, confirm_payment_legacy, create_counter_sale_before_upsell, create_order_before_upsell, create_order_legacy, create_order_store_before_campaign, create_order_store_legacy, get_menu_before_addon_photos, get_menu_before_campaign, get_menu_legacy |
| Catálogo/campanha | add_menu_item_to_stores, add_store_to_menu_items, campaign_discount, campaign_catalog_supported, active_store_campaign, payment_mode, store_admin_json, next_order_number, set_order_channel, touch_updated_at |
| Stock/receita | stock_level, record_stock_movement, consume_order_stock, restore_order_stock, recipe_variant_belongs, fanout_ingredient_to_stores, fanout_store_to_ingredients, record_ingredient_movement, order_ingredient_needs, consume_order_ingredients, restore_order_ingredients |
| Papel/mesa | print_station, ticket_station, build_sale_print_payload, build_full_ticket_payload, enqueue_kitchen_tickets, table_tab_order_ids, table_tab_name, price_table_items, pos_device_store, build_table_comanda, build_table_bill_ticket, build_table_senha, enqueue_table_comanda, after_qr_table_order |
| Caixa | serialize_cash_session_open, enqueue_cash_close_print, cash_store_dashboard, cash_report_cents, cash_day_report, cash_day_print_payload, cash_sold, cash_day_sold |
| Conta | customer_by_token, customer_profile, normalize_phone, normalize_orders_customer_phone, normalize_customers_phone |
| Analítica/sistema | attr_clean, attr_is_meta_id, attr_norm_source, attr_norm_medium, attr_channel, attr_resolve, is_pos_order, record_order_upsells, system_alerts |

São helpers fora da Data API; USAGE/EXECUTE selectivo permite policies e relatórios. Não devem ser apresentados como URLs ou chamadas disponíveis ao cliente.

O schema tipado em `packages/db/src/types.ts` não acompanha este catálogo: faltam brand_settings, cash_day_closes, google_profile_snapshots, order_upsells, store_campaigns, store_pos_settings, store_tvs, table_bills e tv_media. Também faltam campos/funções de e-Mola, TV, caixa diária e resumo mensal. Não se atribui uma única migration à geração dos tipos: já contém outros elementos mais recentes.

### 8.5 Triggers, views, buckets e crons

**16 triggers efectivos por leitura da cadeia** (18 CREATE ao longo do histórico):

| Tabela | Trigger(s) / função |
|---|---|
| menu_items | set_available_on_stock → trigger_set_available_on_stock; menu_items_fill_store_items → add_menu_item_to_stores |
| order_items, payments, print_jobs | *_enforce_store_id → enforce_order_store_id |
| stores | stores_fill_store_items → add_store_to_menu_items; stores_fanout_ingredients → fanout_store_to_ingredients |
| event_log | event_log_enforce_context → enforce_event_context |
| orders | orders_set_channel → set_order_channel; orders_normalize_customer_phone → normalize_orders_customer_phone |
| devices | devices_touch_updated_at → touch_updated_at |
| cash_sessions | cash_sessions_serialize_open → serialize_cash_session_open; cash_sessions_enqueue_close_print → enqueue_cash_close_print |
| recipe_items | recipe_items_variant_belongs → recipe_variant_belongs |
| ingredients | ingredients_fanout → fanout_ingredient_to_stores |
| customers | customers_normalize_phone → normalize_customers_phone |

As views finais são **analytics_sessions** e **online_analytics_events**, ambas security_invoker na 1073. As duas funnel_* foram removidas pela 1066.

| Bucket | Visibilidade/limite declarado | Uso / observação |
|---|---|---|
| payment-proofs | Privado, 10 MB, imagem/PDF | Comprovativos; policy sem loja em V-02 |
| menu-photos | Público, 5 MB, imagem | Produtos; escrita histórica authenticated sem distinguir staff/perfil |
| storefront-assets | Público, 5 MB, imagem | Promoções; escrita histórica authenticated sem distinguir staff/perfil |
| brand-assets | Público, 5 MB, imagem/SVG/ícone | Identidade da empresa |
| tv-media | Público, 200 MB, vídeo/imagem | Media partilhada; tecto global do projecto ainda depende de B-113 |

Não existe definição de job pg_cron na cadeia. Ver handlers e agendador externo na secção 7.4.

### 8.6 Eventos e campos relevantes

Para a referência futura, os contratos que não podem perder-se são: centavos/preço efectivo por loja; client_sale_id/clientCheckoutId; payment reference/idempotency; estado/canal/origem; daily_number versus order_number; store_id/actor_user_id; stock_qty e movimentos; cost_cents congelado; cash_sessions.day_close_id/report.sold; print_jobs.reprint_seq/payload; token/hash de conta; config POS/TV e fotografias Google.

Os principais produtores de event_log são as RPCs de pedidos, caixa, stock, equipa, lojas, POS e TVs. Exemplos já explícitos: store.created/updated/hours_changed/zone_saved/accepting_orders_changed, store.pos_settings_changed, store.ticket_copies_changed, order.address_changed, order.schedule_changed, cash.day_closed, store.tv_created/saved/deleted, tv.media_added/deleted.

Escrita directa na aplicação: `api/cron/alerts/route.ts:114` (alert.sent), `api/cron/digest/route.ts:125` (digest.sent), `api/cron/monthly/route.ts:98` (monthly_digest.sent), `api/staff/[userId]/password/route.ts:75` (staff.password_reset), `lib/payments/direct.ts:114` (payment.*), `lib/server-analytics/conversions.ts:340` (conversion.enqueue_error). Estes caminhos são relativos a `apps/web`.

O catálogo definitivo deve indicar produtor/autor/loja, distinguir actor humano de sistema e reconstruir nomes dinâmicos; não basta extrair literais de inserts. Esta secção é inventário de produtores, não uma promessa de cobertura de todos os payloads.

## 9. Variáveis de ambiente

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

## 10. Pacotes, serviço, scripts e verificações

### 10.1 Responsabilidade e API

| Área | API/responsabilidade observada | Testes existentes |
|---|---|---|
| packages/core | Dinheiro (Cents/cents/conversões/formatMT/orderTotal), transition e tipos, schemas, importação/árvore de menu, getPaymentMode; entrada src/index.ts | 6 ficheiros __tests__; máquina/schemas herdados não equivalem às RPCs activas |
| packages/payments | PaymentProvider Redirect/Direct, Paysuite/Mock/Mpesa/MpesaSimulator/EmolaSimulator, assinatura/parsing/consulta, normalização MSISDN/códigos, conferência de extractos | 9 ficheiros; não provam API real Movitel ou conta do fornecedor |
| packages/receipt | PrintPayload/Op/layout, builders de vias/cozinha/cliente/turno/dia/senha, buildPrintDocument, encodeEscPos, renderPreview, sampleTicket | 4 ficheiros; diferenças locais preexistentes nos modelos/extras |
| packages/db | Tipos de BD, 2 migrations herdadas, gate de integração Supabase; fonte SQL canónica fica em supabase | 36 ficheiros tests; 353 declarações it/test por extracção, não total runtime |
| services/print-bridge | Config por loja, poll/claim, retries, TCP/Windows/série, servidor HTTP local/ledger, gaveta/visor, heartbeat/watchdog, layout/disco, SEA Windows | 18 ficheiros + 2 snapshots; simulação não valida hardware |
| apps/web/lib | Admin/analytics/attribution/agents/brand/cash/payments/POS/TV/auth/account/email/Google/monthly | 74 ficheiros de testes nas libs; não executados aqui |
| scripts | Setup, importação, backups/guard, reconciliação normalizada e pacote de agentes | 6 ficheiros de testes |

As 353 declarações de testes DB incluem **42 suspensas** por B-101 em cash.test.ts, payments.test.ts, referral.test.ts, stock.test.ts e tracking.test.ts. Existem suites cash-v2/stock-v2 activas; isso não prova substituição integral. Os testes de conta existentes cobrem token/hash com fixtures, não a cadeia de enumeração descrita em V-01.

Também há evidência positiva no código: client_sale_id único e bloqueio/reutilização da venda, preço do servidor, stock transaccional, total de pagamentos conferido e troco recalculado. A migration 1077 mantém esses passos; checkout/print_jobs/payments têm constraints próprias de idempotência. Os achados acima são específicos e não autorizam concluir que todo o domínio carece dessas protecções.

Core/payments/receipt têm `build` que apenas imprime TODO; main/types apontam a src/index.ts e Next transpila os três. Não produzem, por esse comando, um pacote compilado autónomo. O bridge tem tsc, bundle esbuild e SEA separados.

### 10.2 Todos os scripts do package.json raiz

| Script(s) | O que executa / limite |
|---|---|
| dev / build | turbo run dev / turbo run build |
| start | pnpm --filter web start |
| test / test:watch | vitest run / vitest |
| test:e2e | playwright test, configuração padrão |
| lint | turbo run lint + typecheck recursivo onde exista |
| db:migrate / db:seed | supabase db reset: reset da BD local, não actualização incremental |
| db:types | supabase gen types --local, redireccionado para packages/db/src/types.ts |
| setup:client / setup:check | setup-client.mjs; normal faz reset, --check valida configuração |
| client:limpar-demo | limpar-demonstracao.mjs; relatório por omissão, mutação com confirmação/projecto explícitos |
| menu:import | import-menu.ts; JSON normalizado, --dry-run, import_menu no modo de escrita |
| bridge:dev | Serviço completo com env em sintaxe POSIX; não portátil em Windows padrão |
| clean | turbo clean + rm -rf node_modules; sintaxe POSIX |
| equipa:criar | criar-equipa.mjs; lê ficheiro de equipa, cria acesso/PIN, suporta dry-run |

Versões declaradas: pnpm **9.0.0**; Node **>=22 e <25**. Workspaces: apps/*, packages/*, services/*.

Bridge: lint/test/test:watch, dev/bridge:dev (watch do serviço), dev:sim (demonstração local), build (tsc), build:bundle (esbuild), build:sea (PowerShell). Web: dev/build/start/lint/typecheck. Os três pacotes de domínio têm exports de fonte e build placeholder, conforme acima.

### 10.3 Scripts fora do menu principal

- import-hawsmash-1.ts: dry-run lê origem; --apply escreve destino; guarda prometida ausente (R-04).
- backup.mjs: pg_dump, pasta/dry-run, retenção 30 dias; transporte externo não implementado.
- check-placeholders.mjs: consulta stores/delivery_zones/staff_profiles; manual, não ligado ao build.
- reconcile-payment-statement.ts: ficheiros JSON locais, não consulta banco/fornecedor nem confirma pagamento.
- package-agent-plugin.mjs: gera pacote por instalação, não publica.
- smoke-public-mcp.mjs: ensaio de protocolo/leitura contra URL fornecido.
- agent-rpc-simulator.ts, orders-rpc-simulator.ts, analysis-rpc-simulator.ts, payment-rpc-simulator.ts: simuladores locais para suites específicas.
- setup-client/validate-config: ainda admite apenas manual/mock/paysuite na validação do provider; comentário sobre cron sem protecção não descreve reconcile actual.

### 10.4 Configurações de teste, CI e hosting

| Configuração | Âmbito efectivo |
|---|---|
| vitest.config.ts | Apenas **/__tests__/**/*.test.ts; exclui **/tests/** e worktrees .kilo |
| packages/db/vitest.config.ts | tests/**/*.test.ts, serialização e globalSetup que protege de impressora real; testes escrevem dados |
| playwright.config.ts | e2e padrão, worker único, build/start localhost:3100; exclui as quatro suites abaixo |
| playwright.agents.config.ts | Web 3017/RPC 3018; agents.spec |
| playwright.orders.config.ts | Web 3019/RPC 3020; orders-pagination.spec |
| playwright.analysis.config.ts | Deriva da de pedidos, muda simulador/testMatch para análise |
| playwright.payments.config.ts | Web 3031/RPC 3032; payment-methods.spec |
| .github/workflows/ci.yml | Push dev/main, PR main; dependências frozen, Supabase local/reset, gate DB separado, lint/unit/build/Playwright padrão |
| turbo.json | Build depende de ^build; outputs .next (não dist/build bridge); globalEnv desactualizado; ficheiros env locais como dependência |
| railway.json | Railpack, pnpm build/start, health /api/health, timeout 300, restart ON_FAILURE até 5; sem scheduler |

Não se verificou execução recente do CI nem configuração remota das branches. Os estados documentados em corridas anteriores são evidência datada, não medições renovadas por esta auditoria.

## 11. Árvore final proposta — depende de aprovação

Os nomes abaixo são **destinos propostos**, ainda não existem. Mantêm português europeu, nomes de produto neutros e os arquivos históricos.

```text
CLAUDE.md                       # decisões/regras + resumos de módulo com links
AGENTS.md                       # método de trabalho; só correcções factuais de caminhos
README.md                       # arranque dev verificável
ROADMAP.md                      # execução e história preservadas
ROADMAP-PRODUTO.md               # produto e fases, com retratos históricos identificados
BLOQUEIOS.md                    # abertos no topo; resolvidos/pacotes datados no fim
docs/
  README.md                     # índice por público
  AUDITORIA-DOCUMENTACAO.md      # este relatório e decisões de revisão
  modulos/
    pos.md
    pedidos.md
    pagamentos.md
    caixa.md
    estoque.md
    impressao.md
    tvs-kds.md
    lojas.md
    equipa.md
    site-checkout.md
    conta-cliente.md
    aparencia.md
    marketing.md
    relatorios.md
    agentes.md
    mesas.md
  referencia/
    migrations.md
    rpcs.md
    tabelas-rls.md
    rotas.md
    ambiente.md
    crons.md
    eventos.md
    testes.md
  operacao/
    instalacao.md
    hardware.md
    runbook.md
    manual-caixa.md
    manual-cozinha.md
    manual-dono.md
    marketing.md
  desenvolvimento/
    cardapio-importacao.md
    analise-interface.md
  planos/
    live.md
    volume.md
  historico/
    instalacao-pos-2026-09-23.md
  decisions/                    # sete ADRs mantidos; acrescentar README
  validation/                   # evidência local datada preservada
  engine/                       # arquivo, não reescrever
  legacy/                       # arquivo, não reescrever
scripts/docs/                   # verificadores/geradores, só nas próximas fases
```

Os README do bridge/plugin/Windows mantêm-se junto dos respectivos componentes, com instruções locais e links para as casas acima. Os CLAUDE/ROADMAP públicos passam a apontar para o módulo e para história identificada, preservando regras ainda válidas. Nenhum ficheiro é apagado por estar sobreposto sem antes integrar o seu conteúdo.

### 11.1 Movimentos propostos

| Origem actual | Destino / tratamento |
|---|---|
| POS-DEFINICOES | Conteúdo POS → modulos/pos; §11 e contratos de papel → modulos/impressao |
| TVS | modulos/tvs-kds, distinguindo TVs entregues e KDS planeado |
| EMOLA-ONLINE | modulos/pagamentos; manter validações datadas ligadas |
| MCP | modulos/agentes; plugin README permanece entrada de pacote |
| RASTREIO + CAMPANHAS + ANALISE-ORIGENS-UPSELL | modulos/marketing; métricas/limites de interpretação também ligados por relatorios |
| EXPORTACAO-CONTABILIDADE | modulos/relatorios, secção de contrato CSV/limites |
| ANALISE-DESIGN | desenvolvimento/analise-interface |
| menu-format | desenvolvimento/cardapio-importacao |
| marketing-setup | operacao/marketing |
| HARDWARE + RUNBOOK + três manuais | operacao, preservando registos datados e distinguindo obrigação de validação efectuada |
| onboarding-checklist | operacao/instalacao, alinhado com marca runtime/multi-loja/SMTP |
| PLANO-LIVE | planos/live; retratos de 22/23 Set identificados como históricos, estado actual separado |
| PREPARACAO-VOLUME | planos/volume, actualizar entregas já feitas sem prometer carga medida |
| INSTRUCOES-POS-MAPUTO | historico/instalacao-pos-2026-09-23, tratado como guião datado, não procedimento geral actual |
| decisions / validation / legacy / engine | Manter caminhos; novo índice ADR; no máximo cabeçalho de contexto nos arquivos |

### 11.2 O que fica no CLAUDE e o que sai

**Fica:** contexto comercial (§0), quatro regras (§1), topologia (§2), stack/decisões (§3), princípios de multi-unidade (§5), invariantes/transversais, NÃO FAZER (§17), instância por cliente e marca como dado (§18). Por domínio, 3–6 linhas e ligação para o módulo.

| Secção actual | Casa do detalhe |
|---|---|
| §4 mapa de ficheiros | README/índice + referencia/rotas + pacotes em referencia/testes |
| §5 schema/gestão de lojas | modulos/lojas e referencia/tabelas-rls/rpcs |
| §6 equipa/PIN/auditoria | modulos/equipa; eventos em referencia/eventos |
| §7 POS | modulos/pos |
| §8 papel/gaveta | modulos/impressao |
| §9 caixa | modulos/caixa |
| §10 stock/receitas | modulos/estoque |
| §11 robustez | Regras transversais ficam; procedimentos → runbook; detalhes → módulos/ambiente/crons/testes |
| §12 estado do pedido | modulos/pedidos; distinguir contrato pretendido do SQL actual |
| §13 loja/agentes | modulos/site-checkout e modulos/agentes |
| §14 ecrãs | modulos/tvs-kds |
| §15 importação/cutover | operacao/instalacao e planos/live; requisito não implementado continua explícito |
| §16 perguntas | BLOQUEIOS, preservando decisões já dadas e sem copiar contactos privados |
| §18 produto | Princípios ficam; mecânica de aparência → modulos/aparencia; evolução → ROADMAP-PRODUTO |
| §19 atendimento | Regras preservadas como secção **planeada** em modulos/site-checkout; B-021, sem inventar schema existente |

### 11.3 Como provar que nenhuma regra se perde

Na Fase 3, antes de cortar texto, congelar a versão inicial permitida da spec e criar um registo de transferência por bloco/parágrafo: secção original, excerto, destino e âncora. Comparar texto normalizado apenas em espaços/quebras de linha, incluindo itens, tabelas e blocos de código. Exigir que cada frase retirada tenha correspondência no destino; alterações de **facto** ficam ligadas a D-* e não contam como simples transferência. Diferenças sem destino bloqueiam a conclusão documental.

Verificar separadamente, por diff, que decisões de `0/1/17 e ADRs não mudaram. Conflitos normativos ficam na secção 5, não em reformulações da regra. A referência a contactos privados mantém-se como referência à fonte restrita/existente, sem duplicar valores neste novo corpus. Esta prova **ainda não foi executada**, pois nada foi retirado.

### 11.4 Decisões fortes candidatas a ADR

Não foram criados ADRs novos.

1. Fecho do dia composto por turnos congelados, sem recalcular histórico (1091/1095).
2. Conta de mesa por loja/dia, QR e balcão juntos, pagamento repartido por pedidos (1081/1092).
3. Resultado incerto de M-Pesa, claim de iniciação e recuperação sem recobrança (1043/1047/1048).
4. Campanhas com preço oficial reajustado/desconto por unidade e restrições de catálogo/canal (1060).
5. Origem POS/online e atribuição best-effort de upsell, com margem desconhecida explícita (1073–1075).
6. Biblioteca de TV partilhada na empresa, configuração por loja e cache offline (1090).
7. Segurança de URLs de pedidos versus conta por dispositivo: rever pressuposto do ADR 0003 à luz de V-01, por decisão formal, não por edição silenciosa.

## 12. Estado, verificações e aprovação

### Verificado nesta fase

- Inventário de páginas/handlers, abas/perfis de navegação, pacotes/scripts/configs, env por nome e cadeia de SQL/RLS.
- Pesquisa de ficheiros referidos e de sobreposições; leitura de sete ADRs e documentação principal.
- Levantamento preliminar de links Markdown relativos nos documentos permitidos, fora dos arquivos históricos: os alvos de ficheiro resolvem. **Isto não valida âncoras, todos os backticks ou exemplos de rotas.** A âncora de 58 mm do README bridge e os caminhos textuais obsoletos continuam registados.
- Nenhuma alteração de runtime, migration, dado ou ambiente foi feita.
- O diff completo contra dev inclui as alterações locais anteriores descritas na secção 1. Não foram revertidas para “limpar” o relatório de alterações; o commit desta auditoria contém exclusivamente este Markdown. A comparação dos hashes dos 41 ficheiros preexistentes modificados/novos permitidos confirma a sua preservação.

### Não executado / não declarado concluído

- **pnpm lint e pnpm test não correram.** Next lint carrega a configuração e ficheiros .env; Vite/Vitest também lêem .env por omissão. Executá-los neste checkout contrariaria o limite de não abrir esses ficheiros. Não se declara árvore verde nesta auditoria. A Fase 4 deve correr num checkout/cópia de validação sem ficheiros secretos, com configuração sintética e dependências verificadas.
- Nenhum teste DB/e2e foi corrido; os de DB escrevem/apagam fixtures e utilizadores. Nenhuma evidência histórica verde foi apresentada como resultado novo.
- O verificador completo de links/backticks/tabelas/RPCs e o registo de transferência de frases pertencem às Fases 3–4. Excepções necessárias incluem URLs/rotas parametrizadas, caminhos exemplificativos, objectos planeados, históricos e ficheiros gerados; cada excepção deve ter razão, não um ignore genérico.
- Estado de migrations aplicadas, gateways, filas, SMTP, scheduler, DNS, hardware e produção não foi consultado.
- Não se fecharam B-* por inferência. A contagem textual é **35 abertos e 2 resolvidos**; as contradições D-21 a D-24 exigem conciliação documental com o âmbito das evidências.

### Aprovação solicitada

Aprovar a árvore da secção 11 e a separação entre **decisão**, **comportamento observado**, **procedimento**, **plano** e **validação datada**. A Fase 3 começará apenas depois dessa aprovação, conforme o pedido. Os achados de código da secção 5 ficam para decisão própria; aprovar a reorganização não autoriza corrigir runtime, executar SQL ou publicar.

## Anexo A — Todas as migrations da árvore auditada

Lista de ficheiros, não lista do que está aplicado numa instalação. Assunto extraído do nome; conteúdo analisado em cadeia na secção 8. `WT` identifica ficheiro preexistente ainda não commitado. Nenhum foi alterado.

Extracção lexical de DDL para localizar assuntos; não resolve SQL dinâmico nem significa que todas as funções listadas continuam com esse nome/schema. A reconstituição final está na secção 8.

| Migration / assunto no nome | Tabelas em CREATE/ALTER/DROP | Funções declaradas | Estado Git inicial |
|---|---|---|---|
| 20260614000001_core.sql | delivery_zones, event_log, menu_categories, menu_items, order_items, orders, settings | public.create_order, public.get_menu, public.get_order_status | base |
| 20260614000002_storage.sql | — | — | base |
| 20260614000003_admin.sql | orders | public.advance_order, public.attach_payment_proof, public.get_order_stats, public.get_orders | base |
| 20260614000004_menu_photos.sql | — | — | base |
| 20260614000005_cash_sessions.sql | cash_sessions | _confirmed_orders_in_period, public.close_cash_session, public.get_cash_dashboard, public.open_cash_session | base |
| 20260614000006_dashboard_views.sql | — | public.get_dashboard_metrics | base |
| 20260614000007_feedback_waitlist.sql | public.order_feedback, public.rate_limits, public.waitlist | public.admin_list_feedbacks, public.admin_list_waitlist, public.join_waitlist, public.submit_feedback | base |
| 20260614000008_harden_rpc_grants.sql | — | — | base |
| 20260614000009_payments.sql | orders, payments, print_jobs | public.confirm_payment, public.create_order, public.get_menu, public.get_order_stats | base |
| 20260614000010_stock_heartbeats.sql | device_heartbeats | public.adjust_stock, public.advance_order, public.confirm_payment, public.get_device_status, public.upsert_heartbeat, trigger_set_available_on_stock | base |
| 20260614000011_print_jobs_payload.sql | — | public.advance_order, public.confirm_payment | base |
| 20260614000012_fix_stock_bool.sql | — | public.advance_order, public.confirm_payment | base |
| 20260614000013_import_menu.sql | — | public.import_menu | base |
| 20260614000014_tracking.sql | settings | public.get_menu, public.get_secret_settings | base |
| 20260614000015_order_status_items.sql | — | public.get_order_status | base |
| 20260614000016_dashboard_fixes.sql | — | public.get_cash_dashboard, public.get_dashboard_metrics, public.get_order_stats | base |
| 20260614000017_analytics_events.sql | public.analytics_events | public.get_funnel_metrics | base |
| 20260614000018_cash_period_since_last_close.sql | — | public.get_cash_dashboard | base |
| 20260614000019_paysuite_settings.sql | settings | public.get_secret_settings | base |
| 20260614000020_stock_check_on_create_order.sql | — | public.create_order | base |
| 20260614000021_order_stats_kpis.sql | — | public.get_order_stats | base |
| 20260614000022_order_stats_deltas.sql | — | public.get_order_stats | base |
| 20260614000023_customers.sql | public.customers | public.get_customer_orders, public.identify_customer | base |
| 20260614000024_referral.sql | public.menu_items, public.orders, public.referral_codes, public.referral_redemptions, public.settings | public.create_order, public.validate_referral | base |
| 20260616000001_product_variants_addons.sql | public.menu_addons, public.menu_item_variants, public.order_items | public.create_order, public.get_menu | base |
| 20260617000001_validate_referral_gift_details.sql | — | public.validate_referral | base |
| 20260618000001_fix_create_order_vrc.sql | — | public.create_order | base |
| 20260618000002_cash_auto_open.sql | — | public.close_cash_session | base |
| 20260619000001_promo_categories.sql | menu_categories, settings | public.get_menu | base |
| 20260620000001_menu_items_updated_at.sql | public.menu_items | — | base |
| 20260620000002_fix_create_order_flow_source.sql | — | public.create_order | base |
| 20260620000003_fix_stock_trigger_track_stock.sql | — | trigger_set_available_on_stock | base |
| 20260621000001_modifier_groups.sql | public.menu_modifier_groups, public.menu_modifier_options, public.order_items | public.create_order, public.get_menu | base |
| 20260621000002_seed_menu_casa_do_bom_pasteleiro.sql | — | — | base |
| 20260621000003_category_parent_id.sql | public.menu_categories | — | base |
| 20260621000004_item_channels.sql | public.menu_items | public.get_menu | base |
| 20260622000001_dine_in_tables.sql | public.orders, public.tables | public.create_order, public.get_table_by_token | base |
| 20260623000001_fix_breakfast_real_menu.sql | — | — | base |
| 20260624000001_photos_and_new_steaks.sql | — | — | base |
| 20260625000001_dine_in_person_labels.sql | public.order_items | public.create_order | base |
| 20260626000001_design_cropped_photos.sql | — | — | base |
| 20260627000001_item_nutrition.sql | public.menu_items | public.get_menu | base |
| 20260819144017_1001_stores.sql | public.order_counters, public.store_hours, public.stores | private.request_store_id | base |
| 20260819144021_1002_store_scope.sql | public.analytics_events, public.cash_sessions, public.delivery_zones, public.order_items, public.orders, public.payments, public.print_jobs | private.enforce_order_store_id | base |
| 20260819144024_1003_store_items.sql | public.store_items | private.add_menu_item_to_stores, private.add_store_to_menu_items, public.create_order, public.get_menu | base |
| 20260819144028_1004_staff_rls.sql | public.cash_sessions, public.event_log, public.staff_profiles, public.staff_stores | private.auth_can_store, private.auth_default_store_id, private.auth_is_owner, private.auth_role, private.can_access_order, private.enforce_event_context, public.advance_order, public.confirm_payment | base |
| 20260819153726_1004_store_defaults.sql | — | — | base |
| 20260819154023_1004_store_hours_validation.sql | — | public.create_order | base |
| 20260819160943_1005_pos.sql | public.devices, public.orders | private.set_order_channel, private.touch_updated_at | base |
| 20260819161131_fix_auth_default_store.sql | — | private.auth_default_store_id | base |
| 20260819161638_create_counter_sale.sql | — | public.create_counter_sale | base |
| 20260819162212_void_counter_sale.sql | — | public.void_sale | base |
| 20260819163240_f2_pos_device_binding.sql | — | public.bind_pos_device, public.create_counter_sale, public.lock_pos_device, public.pos_pin_status, public.set_own_pos_pin, public.unlock_pos_device | base |
| 20260819170750_1006_print_jobs.sql | public.print_jobs | — | base |
| 20260819193000_f3_cash_drawer.sql | public.print_jobs | public.create_counter_sale, public.open_cash_drawer | base |
| 20260819194500_f3_sale_tickets.sql | — | private.build_sale_print_payload, public.create_counter_sale | base |
| 20260819201000_f3_reprint.sql | — | public.reprint | base |
| 20260819203000_f3_bridge_operations.sql | public.print_jobs | public.bridge_heartbeat, public.get_device_status, public.recover_stale_print_jobs | base |
| 20260819210000_f4_offline_sync.sql | — | public.sync_counter_sale | base |
| 20260819210500_f4_offline_sync_fix.sql | — | public.sync_counter_sale | base |
| 20260819211000_f4_offline_sync_columns.sql | — | public.sync_counter_sale | base |
| 20260819212000_f4_price_reconciliation.sql | public.orders | public.sync_counter_sale | base |
| 20260819220000_1007_cash.sql | public.cash_movements, public.cash_sessions, public.settings | private.serialize_cash_session_open, public.add_cash_movement, public.close_cash_session, public.open_cash_session | base |
| 20260819221000_f5_cash_close_print.sql | — | private.enqueue_cash_close_print | base |
| 20260819222000_f5_cash_dashboard.sql | — | private.cash_store_dashboard, public.get_cash_dashboard | base |
| 20260819230000_1008_stock.sql | public.stock_movements | private.consume_order_stock, private.record_stock_movement, private.restore_order_stock | base |
| 20260819231000_f6_stock_consumption.sql | — | private.advance_order_legacy, private.confirm_payment_legacy, public.create_counter_sale_unlocked, public.void_sale | base |
| 20260819232000_f6_menu_availability.sql | — | public.get_menu | base |
| 20260819233000_f6_stock_panel.sql | — | private.assert_stock_manager, private.stock_level, public.adjust_store_stock, public.list_stock_alerts, public.list_stock_movements, public.list_store_stock, public.set_stock_tracking | base |
| 20260819234000_1009_public_stores.sql | — | public.list_public_stores | base |
| 20260819235000_f7_store_identity.sql | — | public.get_order_status, public.get_orders | base |
| 20260819236000_1010_team_system.sql | — | private.assert_staff_admin, public.deactivate_staff, public.get_system_status, public.list_staff, public.list_system_alerts, public.set_staff_access, public.set_staff_pin | base |
| 20260819236500_f8_company_events.sql | — | private.enforce_event_context | base |
| 20260819237000_f8_event_log_company_scope.sql | public.event_log | — | base |
| 20260819238000_f8_daily_digest.sql | — | public.get_daily_digest | base |
| 20260819239000_f9_store_queue.sql | — | public.get_store_queue | base |
| 20260819239500_f9_menu_board.sql | — | public.get_store_board | base |
| 20260820100000_1011_stores_admin.sql | — | private.store_admin_json, public.delete_delivery_zone, public.get_store_admin, public.save_delivery_zone, public.save_store, public.set_store_accepting_orders, public.set_store_hours | base |
| 20260820110000_1012_order_numbering.sql | public.store_order_sequences | private.next_order_number, public.create_counter_sale_unlocked, public.create_order | base |
| 20260820120000_1013_order_numbering_layer.sql | — | private.create_order_store_legacy, public.create_order | base |
| 20260820130000_1014_hawsmash_menu_photos.sql | — | — | base |
| 20260821100000_1015_bebidas_upsell.sql | public.menu_item_variants, public.menu_items, public.settings | private.get_menu_legacy | base |
| 20260821110000_1016_ordem_do_cardapio.sql | — | — | base |
| 20260823120000_1017_dinheiro_por_perfil.sql | — | — | base |
| 20260823140000_1018_variantes_no_balcao.sql | — | public.create_counter_sale_unlocked | base |
| 20260823150000_1019_fix_funnel_view_grants.sql | — | — | base |
| 20260823230000_1020_dois_taloes_por_venda.sql | — | private.build_sale_print_payload, private.print_station, public.create_counter_sale | base |
| 20260824100000_1021_entrega_no_balcao.sql | — | public.create_counter_sale_unlocked | base |
| 20260824120000_1022_agendamento_e_realtime.sql | — | private.build_sale_print_payload, public.create_counter_sale_unlocked | base |
| 20260825120000_1023_morada_e_notas_no_balcao.sql | — | private.build_sale_print_payload, public.create_counter_sale_unlocked | base |
| 20260827100000_1024_ingredientes_e_ficha_tecnica.sql | public.ingredient_movements, public.ingredients, public.order_items, public.recipe_items, public.store_ingredients | private.consume_order_ingredients, private.fanout_ingredient_to_stores, private.fanout_store_to_ingredients, private.order_ingredient_needs, private.recipe_variant_belongs, private.record_ingredient_movement, private.restore_order_ingredients | base |
| 20260827110000_1025_ficha_tecnica_na_venda.sql | — | private.consume_order_stock, private.restore_order_stock, public.create_counter_sale_without_tickets | base |
| 20260827120000_1026_painel_ingredientes_e_cmv.sql | — | private.assert_recipe_owner, public.adjust_store_ingredient, public.delete_recipe_item, public.list_ingredient_movements, public.list_recipes, public.list_store_ingredients, public.report_cmv, public.save_ingredient, public.save_recipe_item, public.set_ingredient_tracking | base |
| 20260827130000_1027_ficha_tecnica_hawsmash.sql | — | — | base |
| 20260828100000_1028_export_contabilidade.sql | — | public.export_sales_for_accounting | base |
| 20260828140000_1029_atribuicao_multi_fonte.sql | public.analytics_events, public.order_attribution | public.get_attribution_report, public.record_order_attribution | base |
| 20260828160000_1030_fila_de_conversoes.sql | public.conversion_jobs, public.order_attribution | public.claim_conversion_jobs, public.complete_conversion_job, public.enqueue_conversions, public.get_conversion_context, public.get_conversion_health, public.record_order_attribution, public.record_server_purchase_event | base |
| 20260828170000_1031_rls_ingredientes_so_equipa.sql | — | public.audit_permissive_policies | base |
| 20260831090000_1032_order_status_senha.sql | — | public.get_order_status | base |
| 20260831110000_1033_cupao_primeira_compra.sql | — | — | base |
| 20260831140000_1034_conta_do_cliente.sql | public.customer_addresses, public.customer_devices, public.customer_login_codes | private.customer_by_token, private.customer_profile, private.secret_hash, public.account_bind_device, public.account_delete_address, public.account_logout, public.account_me, public.account_request_code, public.account_save_address, public.account_verify_code | base |
| 20260831160000_1035_conta_grants.sql | — | — | base |
| 20260831170000_1036_fix_order_status_senha.sql | — | public.get_order_status | base |
| 20260831180000_1037_analise_por_loja_e_tendencia.sql | — | public.get_dashboard_metrics | base |
| 20260831190000_1038_normalizar_telefone_cliente.sql | — | private.normalize_customers_phone, private.normalize_orders_customer_phone, private.normalize_phone, public.account_request_code, public.account_verify_code, public.get_customer_orders, public.get_dashboard_metrics, public.identify_customer | base |
| 20260901100000_1039_identificar_cliente_no_balcao.sql | — | public.create_counter_sale | base |
| 20260902100000_1040_marca_em_runtime.sql | public.brand_settings | public.get_brand, public.update_brand | base |
| 20260902101000_1041_marca_hawsmash.sql | — | — | base |
| 20260902102000_1042_assets_sem_nome_de_cliente.sql | — | — | base |
| 20260903100000_1043_mpesa_directo.sql | public.orders, public.settings, public.stores | public.ensure_payment_reference | base |
| 20260903110000_1044_pagamento_no_painel.sql | — | public.get_store_payment_status, public.save_store_payment | base |
| 20260913225235_1045_paginacao_pedidos.sql | — | public.get_orders | base |
| 20260913232252_1046_emola_por_loja.sql | public.stores | private.payment_mode, private.store_admin_json, public.advance_order, public.create_order, public.get_menu, public.get_store_payment_status, public.save_store_payment | base |
| 20260913233656_1047_checkout_idempotente.sql | public.orders | public.claim_online_checkout, public.create_order | base |
| 20260914001146_1048_emola_directo_preparado.sql | public.stores | private.payment_mode, public.create_order, public.save_store_payment | base |
| 20260916090000_1049_pos_login_por_cartao.sql | public.staff_profiles | public.pos_login_cards, public.pos_login_with_pin | base |
| 20260922193000_1050_alertas_do_cron.sql | — | private.system_alerts, public.list_system_alerts, public.list_system_alerts_all | base |
| 20260922201500_1051_normalizar_telefone_sem_privilegio.sql | — | private.normalize_customers_phone, private.normalize_orders_customer_phone | base |
| 20260923003000_1052_fotos_do_cardapio_com_caminho_absoluto.sql | — | — | base |
| 20260923003520_1060_campanha_por_loja.sql | public.store_campaigns | private.active_store_campaign, private.campaign_catalog_supported, private.campaign_discount, private.create_order_store_legacy, public.get_menu, public.start_store_campaign | base |
| 20260923120000_1061_esgotado_no_balcao.sql | — | public.set_item_availability | base |
| 20260923140000_1062_comanda_padrao_em_todos_os_canais.sql | public.stores | private.enqueue_kitchen_tickets, public.advance_order, public.confirm_payment, public.create_counter_sale | base |
| 20260923160000_1063_talao_online_em_vias.sql | — | private.build_online_ticket_payload, private.enqueue_kitchen_tickets | base |
| 20260923180000_1064_talao_completo_em_todos_os_pedidos.sql | — | private.build_full_ticket_payload, private.enqueue_kitchen_tickets, private.ticket_station, public.create_counter_sale, public.reprint | base |
| 20260923190000_1065_sync_offline_reconhece_via_de_controlo.sql | — | public.sync_counter_sale | base |
| 20260923200000_1066_funil_por_origem.sql | — | private.attr_channel, private.attr_clean, private.attr_is_meta_id, private.attr_norm_medium, private.attr_norm_source, private.attr_resolve, public.get_funnel_metrics | base |
| 20260923210000_1067_definicoes_do_pos.sql | public.store_pos_settings | public.get_pos_settings, public.save_pos_settings | base |
| 20260923210500_1068_definicoes_do_pos_desta_instalacao.sql | — | — | base |
| 20260923220000_1069_funil_legivel_pelo_servidor.sql | — | — | base |
| 20260923230000_1070_cardapio_em_tempo_real.sql | — | — | base |
| 20260923233000_1071_vias_do_talao_no_painel.sql | — | public.set_store_ticket_copies | base |
| 20260924000000_1072_alterar_morada_e_hora.sql | — | public.update_order_details | base |
| 20260924001000_1073_analise_online_pos.sql | — | private.is_pos_order, public.get_attribution_report, public.get_dashboard_metrics, public.get_sales_metrics | base |
| 20260924002000_1074_upsell_atribuido.sql | private.order_upsell_captures, public.order_upsells | private.record_order_upsells, public.create_counter_sale, public.create_order, public.get_upsell_metrics | base |
| 20260924002614_1075_origem_qr_mesa.sql | — | private.is_pos_order | base |
| 20260924010000_1076_senhas_no_balcao.sql | — | public.call_ticket, public.get_store_queue | base |
| 20260924015000_1080_mesmo_produto_em_varias_linhas.sql | — | — | base |
| 20260924020000_1077_extras_no_balcao.sql | — | private.build_full_ticket_payload, public.create_counter_sale_unlocked | WT |
| 20260924030000_1078_foto_dos_extras.sql | public.menu_addons | public.get_menu | WT |
| 20260924040000_1079_cardapio_pizzas_sandes_bebidas.sql | — | — | base |
| 20260924060000_1081_mesas_no_balcao.sql | public.orders, public.table_bills, public.tables | private.after_qr_table_order, private.build_table_bill_ticket, private.build_table_comanda, private.enqueue_table_comanda, private.pos_device_store, private.price_table_items, private.set_order_channel, private.table_tab_order_ids, public.close_table_bill, public.create_order, public.get_table_by_token, public.launch_table_order, public.pos_table_overview | base |
| 20260924061000_1082_mesas_desta_instalacao.sql | — | — | base |
| 20260924120000_1090_tvs_da_loja.sql | public.store_tvs, public.tv_media | public.delete_store_tv, public.delete_tv_media, public.get_tv_screen, public.register_tv_media, public.save_store_tv | base |
| 20260925100000_1091_fecho_do_dia.sql | public.cash_day_closes, public.cash_sessions | private.cash_day_print_payload, private.cash_day_report, private.cash_report_cents, public.close_cash_day, public.get_cash_day | base |
| 20260925110000_1092_mesa_com_nome_e_senha.sql | — | private.after_qr_table_order, private.build_table_senha, private.enqueue_table_comanda, private.table_tab_name, public.launch_table_order | base |
| 20260925110500_1093_vinte_mesas_em_maputo.sql | — | — | base |
| 20260925120000_1094_agua_das_pedras_e_creme_cafe.sql | — | — | base |
| 20260926120000_1095_artigos_no_fecho.sql | — | private.cash_day_report, private.cash_day_sold, private.cash_sold, public.close_cash_session | base |
| 20260926140000_1096_resumo_mensal.sql | public.google_profile_snapshots, public.stores | public.get_monthly_digest, public.set_store_google_place | WT |
