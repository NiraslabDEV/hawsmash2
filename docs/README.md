# Documentação do sistema

O [CLAUDE](../CLAUDE.md) conserva decisões e invariantes. Os módulos descrevem a árvore local; [ROADMAP](../ROADMAP.md), [ROADMAP-PRODUTO](../ROADMAP-PRODUTO.md) e [BLOQUEIOS](../BLOQUEIOS.md) distinguem entrega, validação e plano. Código local não equivale a publicação.

## Dono e operação

- [Manual do dono](operacao/manual-dono.md), [runbook](operacao/runbook.md), [hardware](operacao/hardware.md).
- [Lojas](modulos/lojas.md), [equipa/PIN](modulos/equipa.md), [caixa](modulos/caixa.md), [relatórios/exportação](modulos/relatorios.md).
- [Aparência](modulos/aparencia.md), [marketing](operacao/marketing.md), [TVs/KDS](modulos/tvs-kds.md).
- [Instalação](operacao/instalacao.md), [plano LIVE](planos/live.md), [volume](planos/volume.md). Metas não são ensaios concluídos.

## Equipa da loja

- [Manual do balcão](operacao/manual-caixa.md) e [manual da cozinha](operacao/manual-cozinha.md).
- [POS](modulos/pos.md), [pedidos](modulos/pedidos.md), [mesas](modulos/mesas.md), [impressão/gaveta](modulos/impressao.md).
- [Estoque/ficha técnica](modulos/estoque.md), [caixa: turno e dia](modulos/caixa.md).

## Desenvolvimento

O [README raiz](../README.md) explica arranque. Complementos: [formato de cardápio](desenvolvimento/cardapio-importacao.md) e [base visual da análise](desenvolvimento/analise-interface.md).

[Arquitectura](desenvolvimento/arquitectura.md) e [invariantes de robustez](desenvolvimento/robustez.md) conservam os detalhes transferidos da spec. [Migração/cutover](operacao/migracao.md) distingue o plano do alcance do importador. O [atendimento humano no site](planos/atendimento.md) continua planeado.

| Módulo | Contrato |
|---|---|
| [POS](modulos/pos.md) | Terminal, venda, offline, definições e sincronização |
| [Pedidos](modulos/pedidos.md) | Estados, canais, edição e anulação |
| [Pagamentos](modulos/pagamentos.md) | Manual, Paysuite, M-Pesa, e-Mola e reconciliação |
| [Caixa](modulos/caixa.md) | Movimentos, turno/dia e relatórios congelados |
| [Estoque](modulos/estoque.md) | Produto, ingredientes, receita e CMV |
| [Impressão](modulos/impressao.md) | Papel partilhado, bridge, transportes, visor e gaveta |
| [TVs/KDS](modulos/tvs-kds.md) | Ecrãs/media entregues e KDS planeado |
| [Lojas](modulos/lojas.md) | Escopo, horários, zonas e configuração |
| [Equipa](modulos/equipa.md) | Perfis, acessos, PIN e auditoria |
| [Site/checkout](modulos/site-checkout.md) | Montra, carrinho, agendamento e compra |
| [Conta do cliente](modulos/conta-cliente.md) | Dispositivo, moradas e recuperação |
| [Aparência](modulos/aparencia.md) | Marca como dado e fábrica |
| [Marketing](modulos/marketing.md) | Atribuição, consentimento, campanhas e upsells |
| [Relatórios](modulos/relatorios.md) | Vendas, CSV, digest e Google |
| [Agentes](modulos/agentes.md) | MCP/WebMCP e revisão humana |
| [Mesas](modulos/mesas.md) | QR/balcão e conta conjunta |

Referência: [migrations](referencia/migrations.md), [RPCs](referencia/rpcs.md), [tabelas/RLS](referencia/tabelas-rls.md), [rotas/perfis](referencia/rotas.md), [ambiente](referencia/ambiente.md), [crons](referencia/crons.md), [eventos](referencia/eventos.md), [pacotes/scripts/testes](referencia/testes.md).

## Agentes de desenvolvimento

Ler [AGENTS](../AGENTS.md), [CLAUDE](../CLAUDE.md), [ADRs](decisions/README.md) e o módulo afectado. A [auditoria](AUDITORIA-DOCUMENTACAO.md) distingue factos desactualizados de código que viola a spec. Não alterar regras para esconder falhas.

[Prova de preservação e validação documental](validation/revisao-documental-2026-09-26.md). Verificadores em [scripts/docs](../scripts/docs/), sem segredos nem consultas à BD.

## História e componentes

- Ensaios locais [1045](validation/1045-paginacao-local.md), [1046](validation/1046-emola-local.md), [1047](validation/1047-checkout-local.md), [1048](validation/1048-emola-directo-local.md): evidência datada.
- [Guião de instalação POS de 23/09](historico/instalacao-pos-2026-09-23.md), sem valor de procedimento geral actual.
- [Decisões iniciais](historico/decisoes-iniciais.md) e [planos anteriores da montra](historico/montra-plano-anterior.md), preservados com enquadramento histórico.
- [Spec Delivery OS](engine/DELIVERY-OS-CLAUDE.md), [roadmap herdado](engine/DELIVERY-OS-ROADMAP.md), [painel herdado](engine/PainelIfood.md).
- [Spec 1.0](legacy/HAWSMASH-1.0-CLAUDE.md), [roadmap 1.0](legacy/HAWSMASH-1.0-ROADMAP.md), [bridge 1.0](legacy/hawsmash-print-bridge/README.md), [edge functions 1.0](legacy/hawsmash-edge-functions/README.md), [proposta original](legacy/Proposta-NL-2026-HS-EXP.html).
- [Bridge actual](../services/print-bridge/README.md), [Windows](../apps/web/windows/README.md), [plugin](../plugins/restaurant-os/README.md), [instruções do plugin](../plugins/restaurant-os/skills/pedir-comida/SKILL.md).

Engine/legacy são arquivos preservados. As referências técnicas internas podem pertencer ao sistema anterior.
