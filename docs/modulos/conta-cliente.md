# Conta do cliente por dispositivo

A conta permite reconhecer um dispositivo e recuperar nome/moradas no checkout, sem obrigar cada compra a login por SMS ou palavra-passe. É identidade de cliente final, diferente de Supabase Auth da equipa.

**Estado:** fluxo presente no código da árvore de 26/09/2026; não se testaram sessões ou dados reais. O pressuposto de posse do pedido tem uma **violação composta conhecida**, descrita abaixo. O [ADR 0003](../decisions/0003-conta-do-cliente-por-dispositivo.md) continua a decisão normativa; esta documentação não altera a regra para acomodar o problema.

## Quem usa e onde aparece

O cliente usa a conta opcional no `/checkout`, com moradas guardadas, entrada por código e opção “Não sou eu”. O acompanhamento do pedido tenta vincular o dispositivo. Não há uma página independente `/perfil` ou `/conta`. O componente antigo MenuExperience contém identificação soft e overlays, mas não tem importador na montra activa.

Dono/gerente têm uma aba com label Clientes, em `/lista-espera`; porém a leitura directa de `customers` é owner-only e `customer_addresses` não tem grants de leitura directa ao browser. A capacidade visível não equivale à autorização efectiva. As RPCs de conta não concedem privilégios administrativos a essa aba.

## Percurso

1. GET `/api/account` lê o cookie httpOnly `hs_acc` e chama `account_me`. Sem cookie/perfil válido devolve ausência de conta e pode limpar a sessão inválida.
2. Após o pedido, POST com acção bind e UUID chama `account_bind_device`, recebe token/perfil e coloca o cookie. A morada inicial da entrega pode ser guardada com etiqueta Casa.
3. O checkout lê nome e moradas; guardar/apagar morada usa os handlers próprios e o token do dispositivo.
4. Num dispositivo novo, o cliente pede código por telefone. O servidor procura um email de pedido anterior e envia por SMTP. Se não houver endereço/canal configurado, o caminho é fazer uma compra normal nesse dispositivo.
5. O código correcto emite uma nova sessão de dispositivo. “Não sou eu” revoga o token actual por `account_logout` e limpa o cookie.

O código tem validade de dez minutos e limite de tentativas na BD. A resposta de pedido de código não distingue número desconhecido de número sem email utilizável. O endereço completo não regressa ao browser: apenas uma pista mascarada. Falha de SMTP não bloqueia o formulário de compra.

O cookie é httpOnly, SameSite Lax, Secure em produção, com prazo de um ano e âmbito do site. O token não é guardado pelo hook React; a BD guarda hashes do token/código. Num dispositivo partilhado a sessão também é partilhada; limpar os dados do browser remove o cookie. Estes limites são assumidos pelo ADR, não falhas de sincronização a ocultar ao utilizador.

## Dados e RPCs

| Objecto | Conteúdo / acesso |
|---|---|
| `customers` | Identidade por telefone normalizado e resumos de compra |
| `customer_addresses` | Moradas, etiqueta, zona/notas e predefinida |
| `customer_devices` | Hash do token e estado de revogação do dispositivo |
| `customer_login_codes` | Hash/caducidade/tentativas do código |
| `orders` | Fonte da vinculação e do contacto anterior |

As RPCs `account_bind_device`, `account_me`, `account_logout`, `account_save_address`, `account_delete_address`, `account_request_code` e `account_verify_code` são chamadas pelo servidor com service role. `customer_devices`, `customer_login_codes` e `customer_addresses` não são uma API de SELECT directo para anon/authenticated. `customers` tem leitura autenticada para o dono, conforme explicado acima. Helpers privados tratam hash, resolução de token e perfil.

`identify_customer` e `get_customer_orders` são um contrato legado diferente: identificação soft por telefone e resumos, com EXECUTE público. A existência desse contrato é relevante para a vulnerabilidade composta; não o apresentar como prova suficiente para revelar moradas.

| Rota | Método / responsabilidade |
|---|---|
| `/api/account` | GET perfil; POST bind/logout |
| `/api/account/address` | POST guardar e DELETE remover com token do cookie |
| `/api/account/code` | POST pedir ou verificar código |

## Limite de segurança conhecido

O UUID de pedido é tratado por `account_bind_device` como prova de posse. Porém as RPCs públicas de resumo por telefone devolvem IDs de pedidos, e o handler bind aceita esse ID sem outra prova. A combinação permite obter sessão/perfil a partir de um identificador que já é público por telefone. **Hash dos tokens, httpOnly e grants service-only não eliminam esta cadeia.**

É o achado **V-01** da [auditoria, secção 5](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec). Não foi explorado contra dados reais e não foi corrigido nesta tarefa documental. Não prometer privacidade conforme ADR até existir uma correcção de comportamento validada. `get_order_status` não precisa de expor a morada para esta cadeia existir: o perfil devolvido pelo bind é suficiente.

## Código, auditoria e testes

- [Hook useAccount](../../apps/web/utils/useAccount.ts) e [cookie de servidor](../../apps/web/lib/account/session.ts).
- [Handler principal](../../apps/web/app/api/account/route.ts), [moradas](../../apps/web/app/api/account/address/route.ts) e [códigos](../../apps/web/app/api/account/code/route.ts).
- [Cliente Supabase do servidor](../../apps/web/utils/supabase/server.ts) e [SMTP](../../apps/web/lib/email/transport.ts), segundo o [ADR 0004](../decisions/0004-email-smtp-hostinger.md).
- [Migration da conta](../../supabase/migrations/20260831140000_1034_conta_do_cliente.sql), [grants](../../supabase/migrations/20260831160000_1035_conta_grants.sql) e [normalização](../../supabase/migrations/20260831190000_1038_normalizar_telefone_cliente.sql).

O fluxo de conta não grava eventos próprios em `event_log` nestas RPCs/handlers. Mantém estado nas tabelas de dispositivo/código/moradas; a compra original tem a auditoria de pedido. Não inventar eventos de login/revogação para completar um catálogo.

[account.test.ts](../../packages/db/tests/account.test.ts) e [phone-normalization.test.ts](../../packages/db/tests/phone-normalization.test.ts) cobrem partes do contrato de BD. Os testes existentes não devem ser apresentados como prova de ausência da vulnerabilidade composta. A validação de conta/recipes tem histórico pendente em **B-102** e há dependência operacional de SMTP em **B-012**, no [registo de bloqueios](../../BLOQUEIOS.md). Consulte [testes](../referencia/testes.md) para ambiente/comandos; esta reorganização não executou testes DB, emails ou vinculações.
