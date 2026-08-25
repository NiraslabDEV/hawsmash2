# ROADMAP-PRODUTO.md — do HAWSMASH ao Restaurant OS instalável

> **O que é:** o plano para **empacotar** o motor que corre o HAWSMASH e o poder instalar noutro
> restaurante **sem tocar em código**.
>
> **O que não é:** o plano do contrato do HAWSMASH. Esse é o [`ROADMAP.md`](ROADMAP.md) e tem
> prioridade absoluta — o cliente que paga hoje vem sempre primeiro.
>
> **Regras de trabalho:** [`AGENTS.md`](AGENTS.md). **Spec:** [`CLAUDE.md`](CLAUDE.md) §18.
> **Bloqueios:** [`BLOQUEIOS.md`](BLOQUEIOS.md).

**Legenda:** 🔴 bloqueia o empacotamento · 🟡 bloqueia crescer · 🟢 melhoria
**Estado:** `[ ]` por fazer · `[x]` feito · `[~] B-0NN` bloqueado

---

## 0. A DECISÃO DE ARQUITECTURA (fechada — mudar só com ADR)

**Uma instância por cliente.** Cada restaurante tem o seu projecto Supabase, o seu deploy e o seu
domínio. **Um só código-fonte, N instalações.**

**Porque não multi-tenant:** `tenant_id` partilhado dá isolamento **por policy**. Uma policy mal
escrita mostra as vendas de um restaurante ao concorrente do lado. Com instâncias separadas, o
isolamento é físico: não há policy nenhuma a escrever, porque as bases de dados nem se conhecem.
É a mesma lógica da Regra 3 do `CLAUDE.md`, levada um nível acima.

**O que isto custa:** ~32–67 USD/mês de infraestrutura por cliente (Supabase Pro + Railway + email).
É o chão do preço, e é o que torna o painel de frota (P5) obrigatório e não decorativo: a margem
existe enquanto o suporte for barato de prestar.

**Quando se revisita:** quando a poupança de infraestrutura de N clientes pagar o custo de construir
e auditar o multi-tenant. Não antes, e sempre com ADR em `docs/decisions/`.

---

## 1. O PROBLEMA CENTRAL — porque é que hoje não se instala

`config/brand.ts` é importado por **12 ficheiros** através do alias `@brand`. É um módulo TypeScript:
os valores entram no **bundle em tempo de compilação**.

Consequências, todas verificadas neste repositório:

| O que acontece | Porquê |
|---|---|
| Mudar o nome ou a cor **não muda nada** até haver novo build | O valor foi compilado para dentro do JavaScript |
| O dono **não consegue** mudar a sua própria marca | Não há ecrã nenhum — é um ficheiro de código |
| Cada cliente novo é uma **cópia do repositório** | O ficheiro é versionado; dois clientes = dois conteúdos diferentes no mesmo caminho |
| **As tuas melhorias não chegam ao cliente** | Ao trazer o código novo, o `brand.ts` dele colide com o teu — ou é sobrescrito, ou dá conflito, sempre no mesmo ficheiro |

> **É este último ponto que sentiste.** O ficheiro não "perde" as actualizações por magia: ele é o
> único sítio onde a identidade do cliente e o teu código ocupam a mesma linha. Enquanto assim for,
> **a instalação de cada cliente é um ramo do repositório** — e à quinta instalação passas mais
> tempo a resolver conflitos do que a vender.
>
> A saída não é gerir melhor o ficheiro. É **a identidade deixar de viver em código.**

---

## 2. MAPA

| Fase | Entrega | Bloqueia |
|---|---|---|
| **P0** | Fechar a primeira instalação (HAWSMASH) | tudo |
| **P1** | **Identidade em runtime** — marca na BD, editável no painel | P2, P3 |
| **P2** | Loja pública sem cliente lá dentro | P3 |
| **P3** | Segunda instalação, cronometrada | P4 |
| **P4** | Actualizar N clientes sem partir nenhum | P5 |
| **P5** | Painel de frota | crescer |
| **P6** | O que se assina (comercial e legal) | vender |

---

## P0 🔴 Fechar a primeira instalação

**Objectivo:** o HAWSMASH a operar nas duas lojas, sem bloqueios abertos. Empacotar antes disto é
construir sobre areia — cada coisa que ainda falhar no cliente real volta a falhar em todos os outros.

- [ ] Fechar os 7 bloqueios abertos do [`BLOQUEIOS.md`](BLOQUEIOS.md) (hardware, cutover, backups, Sentry)
- [ ] Ensaio geral por loja: 20 vendas de balcão, 5 entregas, 1 fecho de caixa, 1 falha de rede simulada
- [ ] Uma semana de operação real sem incidente que exija código novo

**DoD:** o Ridwan opera sem te telefonar durante cinco dias seguidos.

---

## P1 🔴 Identidade em runtime — **a fase que desbloqueia tudo**

**Objectivo:** a marca sai do código e passa a ser **dados**. O mesmo build serve qualquer
restaurante; o dono muda o que é dele, sozinho, sem deploy.

### Schema

- [ ] Migration `1101_brand.sql` — tabela `brand_settings` (singleton, como `settings`):
      `name`, `tagline`, `legal_name`, `nuit`, `primary_color`, `bg_color`, `text_color`,
      `logo_path`, `favicon_path`, `og_image_path`, `social` (jsonb), `contact` (jsonb),
      `receipt_footer_default`, `updated_at`, `updated_by`
- [ ] Bucket **público** `brand-assets` para logo, favicon e imagens da loja
      (público de propósito — é o logo que aparece na montra; segredos continuam fora daqui)
- [ ] RLS: leitura por `anon` **só** via RPC `get_brand()`; escrita só `owner`
- [ ] `event_log`: `brand.updated` com autor e o que mudou

### Aplicação

- [ ] `get_brand()` — RPC pública, cacheada no servidor (revalidação curta), **com fallback**:
      se a BD não responder, serve o `config/brand.ts` de fábrica. **A loja nunca abre sem marca.**
- [ ] Os 12 sítios que importam `@brand` passam a ler o resultado de `get_brand()`
- [ ] Cores aplicadas por **variáveis CSS** injectadas no layout, não por classes compiladas
- [ ] `config/brand.ts` fica reduzido ao **fallback de fábrica** — deixa de conter o HAWSMASH
- [ ] Marca do HAWSMASH migrada para a BD por migration de dados (não à mão)

### Painel

- [ ] Aba **Aparência** (`(admin)/aparencia`): nome, cores com pré-visualização ao vivo, logo,
      favicon, redes, contactos, rodapé do talão
- [ ] Perfil: só `owner`. Alteração logada.

### Testes

- [ ] `packages/db/tests/brand.test.ts`: `anon` não lê a tabela directamente; `manager` não escreve; `owner` escreve
- [ ] Teste de fallback: sem BD, a loja renderiza com a marca de fábrica
- [ ] E2E: mudar a cor no painel muda a loja **sem novo deploy**

**DoD:** clonar o repo, apontar para um Supabase vazio, e obter uma loja com marca própria **sem
editar um único ficheiro**.

**PROMPT:** *"Executa a P1 do `ROADMAP-PRODUTO.md`: tirar a identidade de `config/brand.ts` para a base de dados. Testes de RLS primeiro. `config/brand.ts` fica só como fallback de fábrica e não pode continuar a conter dados do HAWSMASH. A loja tem de renderizar mesmo com a BD em baixo."*

---

## P2 🔴 Loja pública sem cliente lá dentro

**Objectivo:** a montra deixa de ser do HAWSMASH e passa a ser **um tema**.

`apps/web/app/(public)/_hawsmash/` são ~1.000 linhas de loja feita à medida de um cliente. Ou vira
configuração, ou assume-se como personalização paga — mas não pode ficar como está, com o nome de um
cliente no caminho de um ficheiro que todos os outros vão usar.

- [ ] Decidir e registar em ADR: **tema configurável** ou **montra à medida vendida à parte**
- [ ] Renomear `_hawsmash/` → `_storefront/` (o nome de um cliente não é o nome de um módulo)
- [ ] Secções da página inicial passam a ser dados: ordem, títulos, imagens, blocos ligados/desligados
- [ ] Imagens em `brand-assets`, não em `public/assets/<cliente>/`
- [ ] `public/assets/` fica só com o que é do produto (as marcas dos clientes saem do repositório)

**DoD:** duas instalações com montras visivelmente diferentes, a partir do mesmo build.

---

## P3 🟡 Segunda instalação, cronometrada

**Objectivo:** provar que a checklist de 30 minutos é verdade — com alguém que não escreveu o código.

- [ ] Cardápio de arranque **vazio** com estrutura de exemplo (o seed actual é do Babalaza)
- [ ] Importação de cardápio por ficheiro, com pré-visualização antes de gravar
- [ ] `pnpm setup:client` cobre o caminho todo, incluindo criar o dono e a primeira loja
- [ ] Instalação real cronometrada, com registo do que emperrou
- [ ] `docs/onboarding-checklist.md` corrigido com o que a realidade mostrou

**DoD:** instalação completa em menos de 60 minutos, feita por outra pessoa, com o cronómetro a correr.
Se der mais de 60, o que falhou é requisito — volta para esta fase.

---

## P4 🟡 Actualizar N clientes sem partir nenhum

**Objectivo:** levar uma correcção a todas as instalações com confiança. Hoje não existe processo nenhum.

- [ ] Versão marcada (`git tag`) e `app_version` visível no painel **Sistema** de cada cliente
- [ ] `pnpm client:update` — aplica migrations pendentes e reporta a versão antes e depois
- [ ] Registo de instalações (ficheiro versionado, privado): cliente, projecto Supabase, domínio, versão, data
- [ ] Janela de manutenção declarada e respeitada (nunca em horário de loja)
- [ ] Ensaio: uma correcção levada a duas instalações no mesmo dia, sem incidente

**DoD:** saber, sem abrir um terminal, em que versão está cada cliente.

---

## P5 🟡 Painel de frota

**Objectivo:** saber que um cliente está em baixo **antes** de ele telefonar. É isto que protege a margem.

- [ ] Instância própria (não é o painel de um cliente): estado de todas as instalações
- [ ] Por cliente: última venda, POS, bridge, impressora, fila de impressão, versão, erros 5xx
- [ ] Alertas agregados: um só canal para todas as instalações
- [ ] Digest diário: vendas por cliente, incidentes, o que exige acção tua

**DoD:** um cliente com a impressora em baixo aparece no teu ecrã antes da primeira chamada.

---

## P6 🟢 O que se assina

**Objectivo:** o material que não é código e que trava vendas na mesma. Não depende das fases anteriores —
pode correr em paralelo.

- [ ] **Tabela de preços:** implantação, mensal, loja adicional, o que está incluído, o que é extra
- [ ] **Contrato modelo:** prazos de resposta, manutenção, propriedade dos dados, saída do cliente,
      quem paga a infraestrutura
- [ ] **Licença:** o cliente licencia ou compra? Escrito, antes do segundo cliente perguntar
- [ ] **Política de dados:** o que se guarda dos clientes finais, por quanto tempo, de quem é à saída
- [ ] **Resposta à factura certificada (B-019):** validada com contabilista, escrita numa página
- [ ] **Demonstração pública** com dados fictícios, sempre de pé

**DoD:** conseguires responder a qualquer pergunta de uma reunião de venda sem dizer "vou ver e digo-te".

---

## 3. O QUE **NÃO** SE FAZ NESTE ROADMAP

- ❌ Multi-tenant (`tenant_id`) — decidido em §0, muda só com ADR.
- ❌ Planos comerciais ou gating por funcionalidade dentro do produto. Todos os clientes têm tudo;
  o preço faz-se no contrato, não com um `if` no código.
- ❌ Adiar o contrato do HAWSMASH por causa de trabalho de produto. O cliente que paga vem primeiro.
- ❌ Empacotar antes da P0. Um defeito por fechar multiplica-se por N instalações.
- ❌ Deixar o nome de um cliente em caminhos, tabelas ou variáveis do produto.
