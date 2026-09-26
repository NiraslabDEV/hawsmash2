# Lojas e operação multi-unidade

Uma loja é a unidade física onde se vende, imprime, movimenta stock e fecha caixa. A empresa partilha catálogo e identidade, mas cada unidade tem configuração e operação próprias. O modelo de instância por empresa está no [ADR 0001](../decisions/0001-multi-unidade.md) e na [spec](../../CLAUDE.md).

**Estado:** descrição do código da árvore auditada em 26/09/2026. Não atesta as configurações reais das lojas, hardware, pagamentos, domínio ou migrations aplicadas. A secção Google já existe como trabalho local preexistente, ainda não commitado no início da auditoria.

## Quem usa

| Perfil/contexto | Capacidade prevista no módulo |
|---|---|
| Dono | Criar/configurar lojas, horários, zonas, canais e pagamentos |
| Gerente | Consultar a sua operação e alterar `accepting_orders` com motivo; não configurar credenciais/morada/zonas |
| Caixa/cozinha | Sem acesso à aba Lojas; usam a loja atribuída na sua operação |
| Cliente anónimo | Escolher entre lojas públicas e ler os dados públicos necessários à compra |
| POS / bridge | Loja determinada por dispositivo/configuração, não escolha diária do operador |

O menu do painel permite `/lojas` a dono/gerente; as RPCs decidem quais acções cada um pode executar. A selecção consolidada é leitura, não contexto de uma alteração. Outros módulos, como definições POS e TVs, têm permissões de edição próprias para o gerente.

## Dados

| Tabela | Responsabilidade |
|---|---|
| `stores` | Identidade operacional, slug/prefixo, canais, kill switch, contactos públicos, meios de pagamento e configurações protegidas |
| `store_hours` | Horário por dia da semana e loja |
| `delivery_zones` | Zonas e taxas da unidade |
| `store_items` | Disponibilidade, preço substituto e stock do catálogo nessa loja |
| `staff_stores` / `staff_profiles` | Acesso da equipa e perfil |
| `devices` | Vinculação e estado de terminais/bridge |
| `order_counters` / `store_order_sequences` | Senha diária e sequência de pedidos da loja |
| `store_pos_settings` / `store_tvs` | Configuração de POS e ecrãs, detalhada nos respectivos módulos |

O preço efectivo combina catálogo com `price_cents_override`. O catálogo não é duplicado por loja. Triggers preenchem `store_items` quando entra uma loja ou produto. Horários, zonas e credenciais continuam a precisar de configuração.

## Fluxo do painel e RPCs

1. O painel carrega as lojas e `get_store_admin` para a unidade escolhida.
2. O dono grava identificação/contactos/canais por `save_store`. O slug e o prefixo deixam de ser editáveis depois da criação.
3. `set_store_hours` grava a semana; `save_delivery_zone` e `delete_delivery_zone` gerem zonas/taxas.
4. `set_store_accepting_orders` abre/fecha aceitação com motivo e valida os requisitos de abertura. Esse campo é o kill switch efectivo.
5. `get_store_payment_status` indica quais credenciais estão preenchidas; `save_store_payment` escreve a configuração protegida. As leituras não devem devolver os valores secretos.

A criação de uma loja não equivale a uma unidade pronta a vender. Falta confirmar dados, canais, horário, zonas, pagamento, equipa e equipamento. Copiar a configuração completa de outra loja é uma decisão **aceite mas adiada**, no [ADR 0002](../decisions/0002-criar-loja-a-partir-de-outra.md). O botão de cópia das definições POS não implementa essa criação de loja.

O campo `google_place_id`, gravado por `set_store_google_place`, alimenta o resumo mensal. Não é uma credencial de acesso ao Perfil de Empresa e não activa métricas Google por si; ver [relatórios](relatorios.md).

## Site, painel e POS

`list_public_stores` alimenta `/`, `/api/stores` e a resolução de `/l/[slug]`. `get_menu` recebe a loja explicitamente e devolve disponibilidade, horários, zonas e valores efectivos. O cookie `hs_store` guarda a escolha do site; trocar de loja limpa o carrinho. `/menu` é apenas um redirect para a loja escolhida ou para a loja por omissão configurada.

O POS vincula `devices` a uma loja; o bridge recebe a mesma unidade na sua configuração. O selector de leitura do painel não deve ser confundido com esse vínculo. [POS](pos.md), [impressão](impressao.md) e [equipa](equipa.md) descrevem os respectivos percursos.

## Fontes e auditoria

- [Painel Lojas](<../../apps/web/app/(admin)/lojas/page.tsx>), [pagamentos](<../../apps/web/app/(admin)/lojas/payment-section.tsx>) e [Google](<../../apps/web/app/(admin)/lojas/google-section.tsx>).
- [Contexto da loja](../../apps/web/lib/store-context.ts), [lojas públicas](../../apps/web/lib/public-stores.ts) e [horários](../../apps/web/lib/store-hours.ts).
- [Gestão de lojas, 1011](../../supabase/migrations/20260820100000_1011_stores_admin.sql), [pagamentos no painel, 1044](../../supabase/migrations/20260903110000_1044_pagamento_no_painel.sql) e [resumo mensal, 1096](../../supabase/migrations/20260926140000_1096_resumo_mensal.sql).

Eventos principais: `store.created`, `store.updated`, `store.hours_changed`, `store.zone_saved`, `store.accepting_orders_changed` e `store.payment_changed`. A alteração do Place ID usa auditoria de actualização da loja. Autor e contexto pertencem à acção gravada no servidor; ver [eventos](../referencia/eventos.md).

## Testes e limites conhecidos

[stores-admin.test.ts](../../packages/db/tests/stores-admin.test.ts), [store-payment.test.ts](../../packages/db/tests/store-payment.test.ts), [rls.test.ts](../../packages/db/tests/rls.test.ts) e [e2e de lojas](../../e2e/lojas.spec.ts) cobrem partes do percurso e das permissões. Os helpers têm testes em [lib](../../apps/web/lib/__tests__/). Não foram repetidos como parte desta descrição.

A aba Definições e o indicador global do painel ainda usam campos operacionais herdados de `settings`; o resultado pode contradizer a loja verdadeira. Não se deve apresentar esse indicador como fonte canónica. Outras discrepâncias de isolamento e escrita directa estão na [auditoria, secção 5](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec).

Conferir os bloqueios de zonas/horários/contactos, pagamentos, cutover e equipamento no [registo actual](../../BLOQUEIOS.md), incluindo **B-015** (dados de contacto), **B-100** (M-Pesa directo) e **B-114** (Google/scheduler). Um valor guardado no painel não prova que foi conferido com a operação real.

---

## Contrato preservado da spec

O SQL abaixo é o desenho inicial, não uma migration para executar nem o schema final. Consultar a [matriz actual](../referencia/tabelas-rls.md). A escolha pública usa `delivery_store_id`; `hs_store` é a formulação anterior. Providers foram alargados. RLS/settings divergem da intenção: auditoria V03–V06.

## 5. MULTI-UNIDADE — o coração do 2.0

**Princípio:** uma instância = uma **empresa** = uma BD. Dentro dela, **N lojas físicas**.
`store_id` **não é** `tenant_id`: não há planos, não há gating, não há clientes diferentes na mesma BD.
É a unidade física onde a venda acontece, onde o papel sai e onde o dinheiro é contado.

### 5.1 Schema base (migration `1001_stores.sql`)

```sql
create table stores (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                    -- 'maputo' | 'matola'
  name text not null,                           -- 'HAWSMASH Maputo'
  short_name text not null,                     -- 'Maputo'  (talão, TV, seletor)
  order_prefix text not null unique,            -- 'MPT' | 'MTL'  → MPT-0042
  active boolean not null default true,
  accepting_orders boolean not null default true,   -- kill switch por loja
  -- morada / contacto
  address text, maps_url text, phone text, owner_email text,
  -- canais
  delivery_enabled boolean not null default true,
  pickup_enabled   boolean not null default true,
  counter_enabled  boolean not null default true,
  -- pagamento por loja
  mpesa_number text, mpesa_name text, emola_number text, emola_name text,
  payment_provider text not null default 'manual'
    check (payment_provider in ('manual','mock','paysuite')),
  paysuite_api_key text, paysuite_webhook_secret text,   -- (B) segredo: nunca em RPC anon
  -- talão
  receipt_header text, receipt_footer text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table store_hours (               -- horário por loja (substitui o schedule singleton do 1.0)
  store_id uuid not null references stores(id) on delete cascade,
  dow smallint not null check (dow between 0 and 6),
  opens time not null, closes time not null,
  active boolean not null default true,
  primary key (store_id, dow)
);
```

**`settings` (singleton) continua a existir** e passa a ser **só o que é da empresa**: tracking, chaves de email,
templates, aparência da loja, políticas globais. Tudo o que é **operacional da unidade** (horário, números de
pagamento, morada, zonas, taxas, provider) vive em `stores`. **Nunca duplicar o mesmo campo nos dois sítios.**

### 5.2 Tabelas com `store_id not null`
`orders` · `order_items` (herda por join, mas grava `store_id` para RLS directa) · `payments` · `print_jobs` ·
`delivery_zones` · `store_hours` · `store_items` · `stock_movements` · `cash_sessions` · `cash_movements` ·
`devices` · `staff_stores` · `analytics_events` (nullable: tráfego antes da escolha de loja) · `order_counters`.

### 5.3 Cardápio partilhado, disponibilidade por loja
```sql
-- catálogo (global, uma marca, um cardápio):
menu_categories · menu_items                       -- já existem no motor

-- realidade de cada loja:
create table store_items (
  store_id uuid not null references stores(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  available boolean not null default true,
  price_cents_override int null check (price_cents_override >= 0),  -- null = preço do catálogo
  track_stock boolean not null default false,
  stock_qty int not null default 0 check (stock_qty >= 0),
  low_stock_qty int not null default 0,
  primary key (store_id, menu_item_id)
);
```
- **Preenchimento determinístico:** trigger `after insert on menu_items` cria a linha para **todas** as lojas
  activas; trigger `after insert on stores` cria a linha para **todos** os itens. Nunca "linha em falta = talvez".
- `get_menu(p_store_slug)` devolve **preço efectivo** (`coalesce(override, price_cents)`) e **disponibilidade
  efectiva** (`available and (not track_stock or stock_qty > 0)`).
- Preço diferente entre lojas é suportado **desde o dia 1** (a política de preços entre unidades é decisão do
  cliente — ver §16 Perguntas em aberto).

### 5.4 Numeração de pedidos
```sql
create table order_counters (store_id uuid, day date, seq int, primary key (store_id, day));
```
- `orders.order_number text` = `MPT-0042` (contínuo por loja, para histórico/email/pesquisa).
- `orders.daily_number int` = **número do dia por loja** (1, 2, 3…) — é este que sai grande no talão, na TV de
  senhas e na chamada ao balcão. Reinicia todo o dia, por loja. Gerado no servidor, dentro da transação.

### 5.5 Onde a loja é escolhida
| Contexto | Como |
|---|---|
| **Site (cliente)** | Página de entrada com **escolha de loja** (Maputo / Matola) → cookie `hs_store` + `/l/[slug]`. Zonas, horários, números de pagamento e disponibilidade passam todos a ser dessa loja. Trocar de loja **limpa o carrinho** (preços e stock são de outra unidade). |
| **POS** | O **dispositivo** está amarrado a uma loja (`devices.store_id`). O operador não escolhe — não pode enganar-se. |
| **Painel** | Selector no topo: `Maputo · Matola · Todas`. "Todas" é **só leitura consolidada**; qualquer acção (aprovar, imprimir, fechar caixa) exige loja concreta. |
| **print-bridge** | `.env` com `STORE_ID` — só puxa `print_jobs` da sua loja. |

### 5.6 Gestão das lojas pelo painel (aba **Lojas**)

Uma loja não é código: é uma linha em `stores` com o seu horário, zonas e números. Quem abre, fecha,
muda uma taxa ou corrige o rodapé do talão é o **painel**, nunca uma migration à mão.

| Quem | Pode |
|---|---|
| `owner` | criar loja, editar tudo (morada, contactos, números de pagamento, rodapé, canais, horário, zonas) |
| `manager` | **só** o kill switch da sua loja (`accepting_orders`), com motivo — é decisão de operação, não de configuração |
| `cashier` / `kitchen` | nada |

**Regras que não se negoceiam aqui:**

- **O kill switch real é `stores.accepting_orders`.** `settings.accepting_orders` é herança do motor
  single-store e **não fecha loja nenhuma** — a aba Definições não deve fingir que fecha.
- **`slug` e `order_prefix` são imutáveis depois de criados.** Mudá-los partiria o histórico de pedidos
  (`MPT-0042`), os cookies dos clientes e o `.env` do print-bridge daquela loja.
- **Criar uma loja é criar operação, não só uma linha:** a nova loja nasce com `store_items` para todo o
  cardápio (trigger da 1003) mas **sem horário, sem zonas e sem números de pagamento** — até isso estar
  preenchido a loja não deve aceitar pedidos. A aba mostra o que falta antes de a deixar abrir.
- **Segredos nunca chegam ao browser:** `stores.paysuite_api_key` e `paysuite_webhook_secret` não são
  legíveis pelo cliente autenticado (grant por coluna) e nunca voltam numa RPC de leitura.
- Toda a alteração grava `event_log` com autor e loja: `store.created`, `store.updated`,
  `store.hours_changed`, `store.zone_saved`, `store.accepting_orders_changed`.

> **Âmbito:** editar as lojas existentes é operação normal do contrato. A criação de uma **3.ª loja** continua
> fora do âmbito comercial fechado (§0) — o painel suporta-a, mas abrir uma unidade nova implica hardware,
> formação e suporte que se orçamentam à parte.
