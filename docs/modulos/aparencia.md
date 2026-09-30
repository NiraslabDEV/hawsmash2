# Aparência e identidade da instalação

O dono altera nome, textos, cores, imagens e contactos de marca através de `/aparencia`. A identidade activa é dado em `brand_settings`; não se muda de restaurante editando componentes ou colocando o nome do cliente no código. As regras de produto permanecem na [spec](../../CLAUDE.md) e no modelo de instância do [ADR 0001](../decisions/0001-multi-unidade.md).

**Estado:** implementação observada na árvore de 26/09/2026, sem verificar a marca publicada. A documentação antiga da montra descrevia The Box/configuração em TS; esse não é o mecanismo activo de identidade.

## Fluxo e perfis

1. `get_brand` devolve a identidade pública da empresa.
2. `getBrand()` resolve fábrica + linha da BD e guarda cache de servidor por 60 s.
3. O layout raiz injeta variáveis CSS e o `BrandProvider`; componentes cliente usam `useBrand()`.
4. O layout público gera metadata/OG, tokens da montra e variantes de cor a partir da marca resolvida.
5. O dono grava por `update_brand`. A mudança não precisa de novo deploy, mas pode estar sujeita à cache de leitura.
6. As páginas sem dados próprios (login, checkout, POS, painel) são geradas no build; o `revalidate = 60` do layout raiz regenera-as ao ritmo da cache. Sem ele ficavam com a marca do build até ao deploy seguinte (o favicon da 1109 faltou nelas a 30/09).

Só o perfil `owner` tem a aba e permissão de escrita. `manager`, `cashier` e `kitchen` consomem a identidade através das interfaces que usam. Anónimos recebem os campos públicos; não configurações secretas de pagamento ou email.

## Tabelas, assets e contratos

| Objecto | Uso |
|---|---|
| `brand_settings` | Singleton da identidade e conteúdo de marca |
| `get_brand` | Leitura pública da identidade |
| `update_brand` | Alteração pelo dono, com auditoria |
| `brand-assets` | Bucket público dos assets da marca; upload autenticado pela aba Aparência |
| `settings` / `storefront-assets` | Conteúdo promocional herdado, gerido por PromoSection; não substitui brand_settings |

O fallback de [config/brand.ts](../../config/brand.ts) é neutro e serve quando falta configuração ou a leitura falha. [resolveBrand](../../apps/web/lib/brand/resolve.ts) faz merge profundo; [loadBrand/getBrand](../../apps/web/lib/brand/server.ts) devolvem fallback em caso de erro. A disponibilidade da loja não deve depender da leitura de identidade.

As fontes carregadas por `next/font` continuam escolhidas estaticamente no código. Nome, paleta, imagens e conteúdo editável são dados; isto não é um editor livre do HTML/layout nem permite instalar qualquer fonte em runtime. A existência de campos legados de layout não significa que haja uma rota `/layout-loja` activa.

Os assets de marca, fotos de catálogo e vídeos de TV têm percursos distintos: marca em Aparência, fotos no Cardápio, media na aba TVs. Não usar o bucket privado de comprovativos para nenhum desses conteúdos públicos.

## Fontes e evento

- [Editor Aparência](<../../apps/web/app/(admin)/aparencia/page.tsx>).
- [Layout raiz](../../apps/web/app/layout.tsx) e [layout público](<../../apps/web/app/(public)/layout.tsx>).
- [Contexto cliente](../../apps/web/lib/brand/context.tsx), [resolver](../../apps/web/lib/brand/resolve.ts) e [cache de servidor](../../apps/web/lib/brand/server.ts).
- [Migration 1040](../../supabase/migrations/20260902100000_1040_marca_em_runtime.sql) define tabela/RPCs; os ajustes de dados/assets seguintes constam do [índice de migrations](../referencia/migrations.md).

`update_brand` grava `brand.updated` no `event_log`. É uma alteração de empresa, não uma alteração operacional de uma única loja. O catálogo de [eventos](../referencia/eventos.md) distingue esse contexto.

## Verificação e limites

[Testes de resolução/cache](../../apps/web/lib/brand/__tests__/) cobrem merge e fallback; [brand.test.ts](../../packages/db/tests/brand.test.ts) cobre o contrato de BD; [testes de configuração](../../config/__tests__/) detectam regressos de identidade de cliente ao código/caminhos abrangidos. Não se deve confundir presença destes testes com validação da marca real em todos os ecrãs.

Conferir num ambiente de ensaio: leitura pública, gravação só pelo dono, actualização após cache, assets/OG e fallback sem BD. Nesta reorganização não se executaram alterações de marca nem testes de instalação. Os campos/preços/horários reais pertencem a [lojas](lojas.md), não a este editor.

Permanecem nomes de cliente em alguns scripts/artefactos e assets históricos, com cobertura de teste limitada; ver [auditoria, secção 5](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec). Os dados e acessos por confirmar mantêm-se em [BLOQUEIOS](../../BLOQUEIOS.md); não há um ADR novo criado por esta documentação.

---

## Contrato preservado da spec

Regras vinculativas. Versão e actualizador existem; frota agregada e limpeza completa de nomes de cliente continuam pendentes. Caminhos antigos abaixo são história de migração, não destinos actuais.

## 18. PRODUTO — do HAWSMASH ao Restaurant OS instalável

> O HAWSMASH 2.0 é a **primeira instância multi-unidade** deste motor. Esta secção fixa as regras que
> permitem instalar o mesmo motor noutro restaurante **sem tocar em código**. O plano por fases está em
> **[`ROADMAP-PRODUTO.md`](../../ROADMAP-PRODUTO.md)**.
>
> **Prioridade:** o contrato do HAWSMASH (§0) vem sempre primeiro. Nada nesta secção justifica atrasar
> a operação do cliente que paga hoje.

### 18.1 Modelo: uma instância por cliente

Cada restaurante tem o **seu** projecto Supabase, o **seu** deploy e o **seu** domínio.
**Um só código-fonte, N instalações.**

`store_id` continua a ser a **unidade física** dentro de uma empresa (§5). Não há, e não vai haver,
`tenant_id`: o isolamento entre clientes é **físico** (bases de dados diferentes), não por policy.
Uma policy mal escrita mostraria as vendas de um restaurante ao concorrente — com instâncias
separadas esse erro é impossível de cometer.

Mudar isto exige **ADR** em `docs/decisions/`. Não se discute em código.

### 18.2 A marca é dado, nunca código

**Regra:** nenhuma identidade de cliente vive num ficheiro `.ts`. Nome, cores, logo, redes, contactos
e textos de marca vivem em **`brand_settings`** (singleton, como `settings`) e editam-se na aba
**Aparência** do painel, pelo `owner`.

`config/brand.ts` fica reduzido a **fallback de fábrica**: o que a loja mostra quando a base de dados
não responde. Nunca contém o nome nem as cores de um cliente real.

**Feito (migrations 1040–1042).** `brand_settings` guarda a identidade; `get_brand()` serve-a ao
público; `update_brand()` deixa só o dono escrever e regista em `event_log`. A aplicação resolve
**fábrica + base de dados** com merge profundo (`apps/web/lib/brand/resolve.ts`) e serve o resultado
por `getBrand()` no servidor e `useBrand()` no cliente. As cores entram por variáveis CSS no layout
raiz — mudar a cor no painel muda a loja **sem deploy**.

**Porque era inegociável:** `config/brand.ts` era importado por 16 ficheiros através do alias
`@brand` e os valores entravam no bundle em **tempo de compilação**. Enquanto assim foi:

1. mudar a marca não mudava nada sem novo deploy;
2. o dono não conseguia editar a sua própria marca;
3. cada cliente era uma **cópia do repositório** — e as melhorias do produto colidiam sempre no mesmo
   ficheiro, porque era ali que a identidade do cliente e o código partilhavam a mesma linha.

O ponto 3 é o que torna isto uma regra de arquitectura e não uma questão de gosto: **é o que impedia
o produto de escalar para além do segundo cliente.**

### 18.3 O produto não sabe o nome do cliente

Nenhum caminho, tabela, componente ou variável do produto contém o nome de um cliente.
`_hawsmash/` passou a `_storefront/`, `public/assets/hawsmash/` passou a `public/assets/storefront/`
(migration 1042 acerta os `photo_url` já gravados), o logo do talão saiu do código do print-bridge
para um ficheiro de instalação (`brand-logo.b64`), e o instalador do quiosque deixou de trazer o
domínio de um cliente por omissão. Um teste trava o regresso disto.

**Dívida que fica:** `public/assets/{babalaza,casa-do-bom-pasteleiro,thebox}/` — imagens de outros
clientes referidas por migrations já aplicadas do motor herdado. Saem quando essas referências
saírem, não antes.

Personalização de montra é **dados** (secções, ordem, imagens, blocos ligados/desligados) ou é
**trabalho vendido à parte**. Nunca um `if` com o nome de um cliente.

### 18.4 Actualizar sem partir

Toda a instalação tem **versão visível** no painel Sistema e um comando único que aplica as
migrations pendentes e reporta a versão antes e depois. Migrations continuam **forward-only** e
idempotentes (§11.7) — é isso que torna seguro correr a mesma actualização em N clientes.

Manutenção **nunca** em horário de loja.

### 18.5 A economia manda na arquitectura

Uma instância por cliente tem custo fixo (~32–67 USD/mês). A margem existe enquanto o **suporte for
barato de prestar** — a mesma leitura do §0, agora multiplicada por N.

É por isso que o **painel de frota** e os alertas agregados não são melhoria: são a condição para
crescer. Um cliente com a impressora em baixo tem de aparecer no ecrã de quem suporta **antes** da
primeira chamada.
