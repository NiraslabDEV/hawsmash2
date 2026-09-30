# Equipa, acessos e entrada no POS

O módulo atribui uma identidade a cada operador, um perfil e as lojas em que pode trabalhar. `/equipa` serve a administração da equipa; `/pos` serve a entrada diária por cartão e PIN. A sessão pertence à pessoa, não ao terminal. Documento baseado no código auditado em 26 de Setembro de 2026; não foram criadas contas nem verificadas credenciais nesta passagem.

## Perfis

| Perfil | Operação prevista |
|---|---|
| `owner` | Todas as lojas; configura marca, loja, equipa, pagamentos, custos e acessos |
| `manager` | Operação das lojas atribuídas: pedidos, anulação, caixa, contagem/estoque e definições do POS |
| `cashier` | Venda, pagamento presencial, caixa, aprovação de comprovativo pelo POS e disponibilidade dos produtos; sem acesso geral a custos/configuração da empresa |
| `kitchen` | Pedidos e preparação; sem operações financeiras |

As permissões finais são as verificações SQL/RLS de cada operação. Esconder uma aba não é controlo de acesso. Perfis herdados `bar`/`waiter` que ainda aparecem no modelo puro `packages/core/src/order-machine.ts` não são novos perfis operacionais desta instalação.

`staff_profiles` liga `user_id` a nome, perfil, activo e hash de PIN. `staff_stores` atribui unidades. `auth.users` guarda a identidade Supabase; `devices` vincula o terminal à loja. Helpers `private.auth_role`, `private.auth_is_owner` e `private.auth_can_store` aplicam o âmbito. Desactivar uma pessoa preserva a identidade histórica das vendas e dos eventos; não se apagam vendas para remover acesso.

## Administração

1. O dono consulta `list_staff` e as lojas activas no [painel](../../apps/web/app/(admin)/equipa/page.tsx).
2. Criar pessoa envia nome, email, palavra-passe, perfil, lojas e PIN opcional a [`POST /api/staff`](../../apps/web/app/api/staff/route.ts). A operação administrativa usa credenciais exclusivamente no servidor e verifica o utilizador solicitante.
3. `set_staff_access` altera perfil/lojas/estado. A RPC impede o dono de se retirar a si próprio esse acesso pelo mesmo fluxo.
4. `set_staff_pin` define o PIN; a leitura só informa `has_pin`, não devolve o hash nem o PIN.
5. A alteração de palavra-passe passa por [`/api/staff/[userId]/password`](../../apps/web/app/api/staff/[userId]/password/route.ts).
6. `deactivate_staff(p_user_id,p_reason)` revoga com motivo e conserva o histórico.

O [script de criação de equipa](../../scripts/criar-equipa.mjs) é uma ferramenta administrativa separada, com ficheiro de entrada e modo `--dry-run`. O ficheiro de credenciais não é documentação pública e não deve ser copiado para exemplos, logs ou commits. A existência do script não demonstra que os operadores reais tenham sido criados.

## Vínculo, PIN e sessão

O terminal é vinculado por `bind_pos_device`. O primeiro PIN pode ser configurado com `set_own_pos_pin`; `pos_pin_status` informa o estado. `lock_pos_device` e `unlock_pos_device` controlam o bloqueio: botão Bloquear, troca de turno e, se a loja o ligar nas Definições do POS, inactividade (de fábrica desligada desde 30/09 — ver [POS](pos.md)).

`pos_login_cards(p_device_id)` é uma RPC pública limitada a um terminal activo. Devolve nomes, perfil, presença de PIN e estado de bloqueio, não email, telefone ou hash. A escolha do cartão ainda não autentica ninguém.

[`POST /api/pos/login`](../../apps/web/app/api/pos/login/route.ts) valida formato e chama `pos_login_with_pin`, exclusiva de service role. O SQL compara o hash e actualiza tentativas/bloqueio. Falhas devolvem um resultado em vez de abortar a transacção: lançar excepção e reverter o contador eliminaria a protecção contra tentativas repetidas.

Após PIN correcto, o servidor gera um token de ligação mágica e troca-o por uma sessão Supabase **da pessoa**; não envia email nesse percurso. O POS recebe os tokens para a sessão do navegador. O PIN não substitui RLS e não passa a ser uma service key. HTTP 423 distingue bloqueio temporário; configuração/sessão indisponível produz erro explícito. Cinco falhas activam espera crescente, limitada a 15 minutos no contrato de login.

Fontes: [vínculo de dispositivo](../../supabase/migrations/20260819163240_f2_pos_device_binding.sql), [login 1049](../../supabase/migrations/20260916090000_1049_pos_login_por_cartao.sql), [pos-login.tsx](../../apps/web/app/(pos)/pos/pos-login.tsx), [card-login.ts](../../apps/web/lib/pos/card-login.ts) e [session.ts](../../apps/web/lib/pos/session.ts).

## Auditoria e isolamento

Eventos incluem `staff.access_changed`, `staff.access_revoked`, `staff.pin_set`, `pos.login` e `pos.login_failed`. As alterações de equipa são globais e podem conter as lojas no payload; eventos POS incluem a unidade do dispositivo. As acções de venda, gaveta, stock e caixa devem registar o utilizador real da sessão, para responder a “quem fez isto?”. Não registar PIN, palavra-passe ou tokens no payload de auditoria.

O dono poder consultar todas as lojas não autoriza o terminal a trocar de loja numa venda. Os testes de RLS devem tentar a leitura e a escrita da outra unidade com um utilizador comum, não apenas verificar que o selector esconde a opção.

## Testes, limites e decisões

Testes de BD: [team-system](../../packages/db/tests/team-system.test.ts), [pos-card-login](../../packages/db/tests/pos-card-login.test.ts), [RLS](../../packages/db/tests/rls.test.ts) e [RLS permissive](../../packages/db/tests/rls-permissive.test.ts). Testes puros: [card-login](../../apps/web/lib/pos/__tests__/card-login.test.ts) e [session](../../apps/web/lib/pos/__tests__/session.test.ts). [painel-perfis.spec.ts](../../e2e/painel-perfis.spec.ts) verifica percursos por perfil. Não foram executados nesta passagem.

Uma primeira entrada, criação de sessão ou troca de operador precisa da rota de autenticação disponível; não a confundir com a capacidade de conservar uma venda numa sessão já carregada sem rede. A revogação efectiva em dispositivos/sessões e o ensaio de mudança de turno pertencem à validação da instalação.

[ADR 0001](../decisions/0001-multi-unidade.md) fixa a unidade física. [ADR 0003](../decisions/0003-conta-do-cliente-por-dispositivo.md) é **da conta do cliente do site**, não autenticação da equipa. Consultar B-004 e B-110 em [BLOQUEIOS](../../BLOQUEIOS.md), bem como os achados da [auditoria](../AUDITORIA-DOCUMENTACAO.md). Ver [POS](pos.md) para venda e [Caixa](caixa.md) para rendição/fecho de turno.

---

## Contrato preservado da spec

A matriz seguinte é a regra do produto. Desde a 1097/1099 a BD impõe-na nas transições (`advance_order` por perfil), na confirmação de pagamento (só servidor) e nos comprovativos (loja, sem cozinha). Continua por impor a leitura de valores pela cozinha (V-03, B-116). Bloquear um ecrã não impõe regra nenhuma na BD.

## 6. EQUIPA, PERFIS E AUDITORIA

```sql
create table staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner','manager','cashier','kitchen')),
  pin_hash text null,                    -- PIN de 4-6 dígitos: entrada no POS pelo cartão + acções sensíveis
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table staff_stores (
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  primary key (user_id, store_id)
);
```

| Perfil | Vê | Pode |
|---|---|---|
| `owner` | **todas** as lojas | tudo, incluindo definições, preços, equipa, anulações, consolidado |
| `manager` | as suas lojas | operação completa da loja: aprovar, anular, abrir/fechar caixa, sangria, estoque, cardápio |
| `cashier` | a sua loja | vender no POS, imprimir, receber, abrir gaveta **em venda**, abrir/fechar a sua caixa; **aprovar pedidos online depois de conferir o comprovativo no POS** e **marcar produtos esgotados/disponíveis** (só a disponibilidade — quantidades, contagens e quebras continuam do `manager`). Decisão do dono, 23 Set |
| `kitchen` | a sua loja | ver pedidos e avançar estado (em preparo → pronto). Não vê dinheiro |

### Helpers de RLS (SECURITY DEFINER, `search_path = ''`, `stable`)
`auth_role()` · `auth_is_owner()` · `auth_can_store(p_store uuid)` — **toda** a policy usa `auth_can_store(store_id)`.
Nunca `using (true)`. O `staff_all` do motor herdado é **substituído** loja a loja na migration de multi-unidade.

### Auditoria (`event_log`, append-only, com actor)
Grava **sempre**, com `actor_user_id` + `store_id`: aprovação/recusa de pedido, anulação de venda, abertura de
gaveta fora de venda, sangria/reforço, abertura/fecho de caixa com diferença, alteração de preço, alteração de
stock à mão, remoção de acesso. É isto que responde à pergunta "quem fez isto?" — e é a resposta contratual da
proposta (§6 "Registo de auditoria").
