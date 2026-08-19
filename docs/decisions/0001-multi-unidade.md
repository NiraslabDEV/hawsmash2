# ADR 0001 — `store_id` representa uma unidade física

- Estado: aceite
- Data: 2026-08-19
- Decisores: Niraslab / HAWSMASH

## Contexto

O HAWSMASH vai operar Maputo e Matola na mesma aplicação e na mesma base de dados. As duas lojas partilham a
marca e o catálogo, mas têm operação própria: preços e disponibilidade, estoque, pedidos, pagamentos,
impressão, dispositivos e caixa.

O isolamento não é comercial nem entre clientes diferentes. É operacional e financeiro entre unidades da
mesma empresa. Confundir estes dois conceitos acrescentaria planos, permissões e complexidade que não servem
o contrato e aumentaria o risco de misturar vendas das lojas.

## Decisão

Usaremos `store_id` como identificador obrigatório da unidade física em todas as tabelas operacionais.
`store_id` não é `tenant_id`; esta aplicação representa uma empresa e não implementa multi-tenancy, planos ou
gating comercial.

O catálogo base (`menu_categories` e `menu_items`) é partilhado. A realidade por loja vive em `store_items`,
que define disponibilidade, preço efectivo e estoque. Utilizadores recebem acesso através de `staff_stores`;
as policies RLS autorizam cada linha pela loja e o perfil `owner` pode consultar todas as lojas.

## Regras de execução

- Toda a linha operacional nova tem `store_id not null`, excepto eventos de tráfego anteriores à escolha da loja.
- Toda a query operacional é filtrada por loja.
- Não existem policies `using (true)` em tabelas com `store_id`.
- O acesso público é feito por RPCs com colunas explicitamente listadas, não por `select *`.
- O selector “Todas” no painel é apenas de leitura; mutações exigem uma loja concreta.
- O POS e o print-bridge ficam associados a uma loja pelo dispositivo/configuração, sem escolha manual diária.
- Testes de RLS provam que um utilizador de Matola não lê nem escreve linhas de Maputo e bloqueiam o CI.

## Consequências

Ganhamos isolamento verificável, relatórios consolidados e uma extensão simples para novas unidades da mesma
empresa. Em troca, todas as migrations e queries operacionais têm de transportar a loja explicitamente e os
fluxos consolidados precisam de separar leitura de mutação.

Uma futura plataforma para restaurantes diferentes exigirá outro ADR e uma estratégia própria de `tenant_id`.
Não será introduzida implicitamente neste projecto.
