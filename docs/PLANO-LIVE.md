# PLANO-LIVE.md — pôr o LIVE do HAWSMASH 2.0 redondo

> **O que é:** o plano de infraestrutura que leva o `hawsmash2` (LIVE) de "base de dados com cardápio"
> a "sistema que a equipa consegue usar". Termina onde o [`RUNBOOK.md §6`](RUNBOOK.md) começa — o ensaio
> geral e a checklist de abertura não se repetem aqui.
>
> **Aberto em:** 2026-09-22 · **Conduz:** Niraslab (Gabriel)
> **Não inclui:** data de cutover nem DNS — isso é [`B-010`](../BLOQUEIOS.md) e é agenda com o cliente.

---

## 1. Estado verificado em 2026-09-22

Primeiro levantamento por DNS público (`8.8.8.8`, `1.1.1.1`), HTTP aos dois ambientes e leitura dos
bundles JS servidos. **Revisto ao fim do dia**, já por consulta às duas bases de dados e por
`supabase migration list` — o que abaixo diz "confirmado" foi lido, não deduzido.

| Peça | Estado (22 Set, fim do dia) |
|---|---|
| Supabase LIVE `hmutptcbusxncnofinrw` | **vivo** · **103 migrations, última `20260831170000` (1036) — confirmado por consulta** · 2 lojas, 16 itens, 32 `store_items`, 3 horários por loja, 1 zona por loja |
| Supabase STAGING `pqjoanrsjkddkjsllqov` | **vivo outra vez** — restaurado. Era NXDOMAIN de manhã. Migrado até à `1051` |
| Migrations por aplicar no LIVE | **15** — `1037` … `1051` (as 13 previstas + `1050` e `1051`, abertas hoje) |
| Contas de staff no LIVE | **nenhuma** — 0 em `auth.users`, 0 em `staff_profiles`, 0 dispositivos |
| Gate `pnpm lint && pnpm test` | **verde** — 91 ficheiros, 788 testes. Estava vermelho por um worktree morto, não por código (ver §2.5) |
| Gate de integração contra staging | **verde** — inclui `rls.test.ts` (42) e o `pos-card-login` da `1049` (11), que fecha o [`B-110`](../BLOQUEIOS.md) |
| Railway `staging` | serve HTTP 200, compilado contra o ref antigo → reconfirmar agora que o Supabase voltou |
| Railway `production` | serve HTTP 200 mas **sem `*.supabase.co` no bundle** — variáveis nunca preenchidas; aponta ao ramo `dev` |
| `main` vs `dev` | **108 commits** atrás |
| `hawsmash.com` | ainda o HAWSMASH 1.0, intocado |

**Consequência que explicou o sintoma inicial:** o `/login` faz `signInWithPassword` e, em qualquer erro,
mostra sempre *"Email ou palavra-passe incorretos"* (`apps/web/app/login/page.tsx:22`). Com o Supabase de
staging inexistente, a frase aparece com a senha certa. As credenciais em `CREDENCIAIS-ACESSOS.md` nunca
estiveram erradas.

### 1.1 Duas coisas que só apareceram ao medir

**O alerta automático nunca disparou.** O cron de `/api/cron/alerts` corre com a chave de serviço e
sem sessão; a `list_system_alerts()` começava por exigir `auth.uid()` e respondia `not_authenticated`
em todas as corridas. Uma bridge esteve **20 dias calada** sem um único email. Corrigido pela
**`1050`**, que dá ao cron uma porta própria (`list_system_alerts_all`), aberta só ao `service_role`,
sem mexer no que a equipa vê no painel. Sem isto, a linha "um alerta automático a disparar" da Fase 6
reprovava.

**O gate de integração não era repetível.** O `recipes.test.ts` deixa os ingredientes gastos e o
`stock-v2.test.ts` corre **antes** dele: a mesma suite passava numa corrida e falhava na seguinte, em
`out_of_ingredient: Queijo cheddar (fatia)`. Não era regressão nenhuma — era o vizinho. O `beforeEach`
do `stock-v2` passou a encher também os ingredientes, e o ficheiro foi provado a partir do estado
exacto que falhava (tudo a zero): 13/13. Um gate que depende da ordem é pior do que não ter gate,
porque ensina a ignorar vermelhos.

**O script do cutover ia falhar no dia.** As triggers que normalizam o telefone (`1038`) vivem em
`private` e ficaram `security invoker`: qualquer escrita directa em `orders` ou `customers` com a chave
de serviço morre em `42501 permission denied for schema private`. O site não sente — escreve tudo por
RPC `security definer` — mas o `scripts/import-hawsmash-1.ts`, que insere `orders` e `customers`
directamente, sente. É o script do §15. Corrigido pela **`1051`**.

---

## 2. Princípios que este plano não quebra

1. **Staging antes de produção** ([`CLAUDE.md §2`](../CLAUDE.md)). É por isso que a Fase 1 existe: sem
   staging, as 11-13 migrations chegariam ao LIVE sem nunca terem corrido em lado nenhum — incluindo a
   `1049`, que mexe em `staff_profiles` e na autenticação do POS e que o [`B-110`](../BLOQUEIOS.md) diz
   nunca ter corrido contra um Supabase real.
2. **Migrations versionadas, forward-only, nunca SQL à mão em produção** (`§11.7`). Onde for preciso
   escrever dados em vez de schema — a primeira conta de dono — usa-se **script versionado e idempotente**,
   não o editor SQL do dashboard.
3. **Nunca em horário de loja** (`RUNBOOK §5`). Qui–Sáb, Maputo 11:00–21:30, Matola 12:00–21:30.
   Janela de trabalho: manhã cedo ou dia de loja fechada.
4. **O 1.0 continua a vender** até ao cutover. Nada neste plano lhe toca.
5. **O gate mede a árvore de trabalho.** Havia um worktree git esquecido em
   `.kilo/worktrees/closed-whippet`, parado no commit `d251d92` (2 Set). O `include` do
   `vitest.config.ts` apanhava-o: **56 dos 147 ficheiros de teste eram essa cópia** — 18 a falhar
   contra o código de hoje e 38 a passar, a inflar a contagem nos dois sentidos. O `exclude` passou a
   travar `**/.kilo/**`. O worktree em si não se apagou: é de outra ferramenta, e apagá-lo é decisão
   de quem o criou.

---

## 3. Fase 0 — decisões que bloqueiam o arranque

| # | Decisão | Quem | Porque bloqueia |
|---|---|---|---|
| 0.1 | Estado do `hawsmash2-staging` no dashboard: **pausado** ou **apagado**? | Gabriel | Pausado = *Restore* e a Fase 1 encolhe para 10 minutos. Apagado = projecto novo e ref novo em toda a configuração |
| 0.2 | Chave `service_role` e password de BD do `hawsmash2` | Gabriel | Sem elas não se confirma o que está aplicado no LIVE, não se cria a equipa e não corre o `check-placeholders` |
| 0.3 | Emails definitivos da equipa: reais por pessoa ou um por papel? | Gabriel + Ridwan | Os `@hawsmash.test` são contas de teste e não recebem email — recuperação de senha e alertas ficam sem destino |
| 0.4 | Um Paysuite para as duas lojas ou um por loja? | Ridwan | [`B-001`](../BLOQUEIOS.md) / `CLAUDE.md §16 #1`. A Fase 5 preenche a chave; se for uma por loja, vai em `stores`, não no ambiente |

**0.1 e 0.2 travam tudo.** 0.3 trava a Fase 4. 0.4 trava só a parte de pagamento da Fase 5.

---

## 4. Fase 1 — devolver o staging ✅ **feita a 22 Set**

**Objectivo:** ambiente de teste vivo e, de caminho, a prova de que a cadeia das migrations corre
limpa. É esta fase que torna seguras as Fases 3 e 4.

**Como correu:** o projecto estava **pausado**, não apagado — caminho 1A, o ref manteve-se. Estava
parado na `1039`; aplicaram-se as **10 pendentes** (`1040`→`1049`) e depois as duas abertas hoje
(`1050`, `1051`). Verificado a seguir: `get_brand()` responde ao anónimo com a identidade certa, e as
**13 fotos de cardápio que a `1042` reescreveu de `hawsmash/` para `storefront/` resolvem todas em
disco** — era o ponto onde um caminho antigo dava 404 em silêncio.

### 1A · Se estiver pausado
1. Dashboard → *Restore project*. O ref mantém-se, o DNS volta, os dados e as contas estão lá.
2. Confirmar: `Resolve-DnsName pqjoanrsjkddkjsllqov.supabase.co` devolve IP.
3. Entrar no painel de staging com a conta de dono de `CREDENCIAIS-ACESSOS.md`.
4. Saltar para 1C.

### 1B · Se estiver apagado
1. Criar projecto Supabase novo (Free), região a mesma do LIVE.
2. Aplicar as **116 migrations** por ordem, do zero.
3. Correr o seed de configuração (lojas, horários, números, cardápio).
4. Actualizar o ref novo em **três sítios**: `apps/web/.env.local`, `.env.local` da raiz, e as variáveis
   do ambiente `staging` no Railway.
5. Actualizar `CREDENCIAIS-ACESSOS.md` e a referência ao ref antigo em `BLOQUEIOS.md:420`.
6. Recriar a equipa de teste (o mesmo script da Fase 4, apontado a staging).

### 1C · Fechar o B-110 ✅
`packages/db/tests/pos-card-login.test.ts` corrido contra staging: **11/11 verdes** — o terminal só lista
a equipa da sua loja, o PIN errado conta e trava ao quinto, a entrada certa limpa o castigo, e o browser
não chama a verificação do PIN. É a primeira vez que a `1049` correu contra um Supabase a sério.

**Falta ainda**, e não se tira de um teste: uma **entrada real pelo cartão num terminal**, com os dois
perfis (caixa e gerente). **Exige o provedor de email activo** no projecto Supabase — sem ele o
`/api/pos/login` responde 503 e o POS manda entrar por email.

**Critério de saída:** staging responde, login entra, POS vincula e o gate de `pos-card-login` está verde.

---

## 5. Fase 2 — gate verde e `main` a par

1. ✅ `pnpm lint && pnpm test` — **verde**: 91 ficheiros, 788 testes. Condição de merge, sem excepções
   (`CLAUDE.md §11.4`).
2. ✅ Ensaiado em staging o que os 108 commits trouxeram e o staging antigo nunca viu: e-Mola por loja
   (`1046`), checkout idempotente (`1047`), paginação de pedidos (`1045`), marca em runtime
   (`1040`–`1042`), login por cartão (`1049`). O gate de integração corre agora a **pasta inteira** —
   `test:db` tinha uma lista curada de 9 ficheiros e escondia os outros 11, que é como o
   `account.test.ts` ficou três semanas a falhar sem ninguém dar por isso.
3. ⬜ Merge `dev` → `main`. **Este é o passo irreversível na prática** — o Railway `production` vai passar
   a construir daqui.

**Critério de saída:** `main` = `dev`, CI verde.

---

## 6. Fase 3 — schema do LIVE em dia ✅ **feita a 23 Set, 00:20–00:40 (Maputo)**

**Janela:** quarta-feira de madrugada. As lojas abrem Qui–Sáb, e o 2.0 ainda não serve ninguém —
0 dispositivos, 0 contas, 0 eventos em 7 dias, último pedido a 31 de Agosto (o histórico importado).
O `hawsmash.com` continua no 1.0, intocado.

**O que foi aplicado:** as 15 pendentes (`1037`…`1051`) mais a **`1052`**, aberta durante esta janela
(ver 6.1). O LIVE passou de 103 para **119 migrations**, última `20260923003000`. A lista de versões
foi comparada linha a linha com os ficheiros do repo: **idêntica**.

**Como foi aplicado, e a dívida que isso deixa:** pelos ficheiros versionados do repo, um a um, mas
através da ligação de serviço e não do `supabase db push` — a password de BD do LIVE continua por
obter (decisão 0.2). A ferramenta regista cada migration com a data de hoje em vez da do ficheiro, o
que faria o CLI tentar reaplicá-las para sempre; as versões foram corrigidas para as canónicas no fim.
**Assim que a password existir, o caminho normal volta a ser o `db push`** — é byte-exacto e não
precisa desta correcção.

### 6.1 O que a janela encontrou

**As fotos do cardápio estavam todas partidas, e não era da `1042`.** 15 dos 16 `menu_items` tinham o
`photo_url` com o caminho **relativo** do 1.0 (`assets/burger.webp`, `assets/bebidas/sprite.webp`) —
entrou com a importação do menu antigo, por cima do que a 1014/1015 tinham gravado. O `photo_url` vai
directo para o `src` da imagem sem normalização, por isso em `/l/maputo` o browser pedia
`/l/assets/burger.webp` e recebia 404. **Na abertura, o cardápio abria sem uma única foto.** A `1042`
não apanhou isto porque procurava `/assets/hawsmash/`, que era outro problema.

Corrigido pela **`1052`**: bebidas por prefixo, hambúrgueres por produto (cada um aponta agora para o
ficheiro com o nome dele). Verificado a seguir: os 13 caminhos distintos existem todos em
`apps/web/public/assets/storefront/`. Há teste a travar o regresso (`menu-photo-paths.test.ts`).

**Fica por resolver:** o item **"Macon smash"** aponta para uma imagem alojada no Supabase do
HAWSMASH 1.0. Funciona enquanto o 1.0 existir — o §15 dá-lhe 90 dias depois do cutover. A foto tem de
ser recarregada pelo painel; não se inventa aqui um ficheiro que não há.

**A marca do staging estava trocada, e foi um teste que a trocou.** O `brand.test.ts` guardava o
estado lendo `brand_settings` directamente — que é precisamente o que a `1040` fechou (§18.2:
"Escrita: por RPC, nunca directa"). A leitura vinha vazia, o `brandBefore` ficava nulo, e o `afterAll`
seguia pelo ramo de **apagar** em vez de repor. O staging estava a servir "Marca de Teste
179009898593" com um tema de uma só chave. O teste passa agora a guardar por `get_brand()` e a repor
por `update_brand()` com a sessão de dono que já cria; a marca real foi reposta a partir do ficheiro
da `1041` e sobrevive a uma corrida do teste — verificado.

**O LIVE e o staging têm cardápios diferentes.** O LIVE tem 16 itens (inclui "Macon smash"), o staging
15. Não é erro de ninguém — são bases separadas com histórias separadas — mas quer dizer que **um
ensaio em staging não prova o cardápio do LIVE**. A Fase 6 tem de olhar para a loja de produção.

### 6.2 Verificação feita na mesma janela

- `get_menu('maputo')` responde: 4 categorias, 16 itens, 3 horários, 1 zona, `emola_provider` presente;
- `get_brand()` devolve a identidade HAWSMASH;
- a trigger da `1051` provada com uma escrita directa à chave de serviço: `+258 84 000 0997` gravou
  `840000997`, e antes disto morria em `42501`. **A linha de prova foi apagada** — o LIVE ficou nos
  mesmos 714 pedidos com que entrou;
- avisos do Supabase relidos: nada de novo. Os `SECURITY DEFINER` chamáveis por `anon` são o padrão do
  §17 (acesso público só por RPC), e os dois `security definer view` (`funnel_rates`,
  `funnel_by_source`) são anteriores a esta janela — ficam anotados, não foram tocados.

### 6.3 O plano original desta fase

> Janela: loja fechada. Antes de começar, **snapshot PITR** anotado (`RUNBOOK §2`).

1. ✅ **Confirmado a 22 Set:** o LIVE tem **103 migrations**, a última `20260831170000` (`1036`). A nota
   de 31 de Agosto estava certa — e 103 + 15 = 118, que é o que o repo tem.
2. Aplicar as **15 pendentes** (`1037`…`1051`) por ordem. São forward-only e idempotentes.
   Atenção a três delas: a `1042` reescreve `photo_url`, a `1049` muda a entrada do POS, e a `1051`
   é a que o `import-hawsmash-1.ts` precisa para não morrer em `42501` no cutover.
3. Reconferir o que as migrations de marca fizeram: a `1041` carrega a identidade HAWSMASH e a `1042`
   acerta `photo_url` de `hawsmash/` para `storefront/`. Abrir a loja e confirmar que as **fotos do
   cardápio aparecem** — é o ponto onde um caminho antigo dá 404 em silêncio.
4. `node scripts/check-placeholders.mjs` contra o LIVE → tem de sair a zero.

**Rollback:** migrations não se revertem — escreve-se uma migration nova (`RUNBOOK §5.6`). Para estrago
real, PITR para o snapshot da linha 1.

**Critério de saída:** contagem de migrations do LIVE = repo; `check-placeholders` a zero.

---

## 7. Fase 4 — a equipa no LIVE

**O ovo e a galinha:** criar staff exige uma sessão de `owner` já existente — a rota verifica o perfil de
quem chama, nunca um campo do corpo (`apps/web/app/api/staff/route.ts:50`). Com zero contas no LIVE, o
painel não consegue criar a primeira.

**Resolvido:** `scripts/criar-equipa.mjs` (`pnpm equipa:criar`) — **escrito e provado contra o staging a
22 Set**, incluindo três corridas seguidas para mostrar que não duplica nada. Lê um
`CREDENCIAIS-EQUIPA.json` (o `.gitignore` já trava tudo o que comece por `CREDENCIAIS`; o modelo
versionado é `scripts/equipa.exemplo.json`) e faz, por esta ordem:

1. garante o utilizador em `auth` — cria se faltar, reaproveita pelo email se já existir;
2. escreve **só o primeiro dono** em `staff_profiles`/`staff_stores` com a chave de serviço. É o atalho
   do arranque, e é o único;
3. entra como esse dono e cria o resto da equipa pelo **caminho normal do produto** —
   `set_staff_access` e `set_staff_pin`, a mesma ordem de `apps/web/app/api/staff/route.ts`. Assim
   valida-se o que o painel validaria e fica rasto em `event_log` (§6).

Tem `--dry-run`, que imprime quem vai criar sem escrever nada. No fim mostra as passwords geradas
**uma única vez**. O PIN nunca passa pelo script em claro para a base de dados: quem o transforma em
`bcrypt` é a `set_staff_pin`.

1. Fixar os emails definitivos (decisão 0.3).
2. Correr `pnpm equipa:criar --dry-run` e depois a sério contra o LIVE.
3. Entrar no painel como dono e conferir os perfis na aba **Equipa**.
4. Guardar as senhas e os PINs em `CREDENCIAIS-ACESSOS.md` — que **nunca vai ao git** (`.gitignore`).
5. Entregar a cada pessoa só o que é dela.

**Critério de saída:** cada perfil entra no painel, vê a sua loja e nada da outra.

---

## 8. Fase 5 — Railway `production`

Hoje este ambiente é a casca descrita em [`BLOQUEIOS.md:409`](../BLOQUEIOS.md) — responde `{"status":"ok"}`
sem Supabase nenhum por trás. **Parece vivo, e é essa a parte perigosa:** o link tem a palavra "production"
no nome e um envio por engano mostra ao cliente um sistema a fingir que existe.

1. Apontar o ambiente ao ramo **`main`** (hoje está em `dev`).
2. Preencher as variáveis: `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do `hawsmash2`,
   `NEXT_PUBLIC_APP_BASE_URL`, SMTP Hostinger, Paysuite (conforme 0.4), tracking.
3. Redeploy e **verificar como aqui se verificou**: o bundle JS servido tem de conter
   `hmutptcbusxncnofinrw.supabase.co`. Se não contiver, a variável não entrou no build.
4. Só então `AGENT_TOOLS_ENABLED` e restantes interruptores, se e quando se decidirem.

**Critério de saída:** `/login` do production entra com a conta de dono criada na Fase 4.

---

## 9. Fase 6 — verificação ponta a ponta no LIVE

Com as lojas fechadas, no ambiente de produção:

- [ ] Login de cada perfil; `manager` da Matola não vê nada de Maputo
- [ ] Vincular um terminal, criar PIN, entrar pelo cartão (§7.1)
- [ ] Uma venda de balcão em dinheiro: talão + comanda + gaveta
- [ ] Um pedido online em cada loja, a cair na loja certa
- [ ] print-bridge com o `STORE_ID` certo, heartbeat verde no painel **Sistema**
- [ ] `/tv/[loja]/menu` e `/tv/[loja]/senhas` a abrir sem sessão
- [ ] Um fecho de caixa com email ao dono a chegar
- [ ] Um alerta automático a disparar (dispositivo desligado 6 minutos)
- [ ] Backup nocturno configurado e **um restauro testado** (`RUNBOOK §2`)

Estas vendas de ensaio ficam na BD de produção. Limpar com `pnpm client:limpar-demo` **antes** de assinar
a checklist de abertura, e reconfirmar o `check-placeholders` depois.

---

## 10. Fase 7 — entrega

A partir daqui manda o [`RUNBOOK.md`](RUNBOOK.md):
- §6 ensaio geral na véspera, por loja (~90 min)
- §7 checklist de abertura, assinada por loja
- Manuais: [`manual-caixa.md`](manual-caixa.md), [`manual-cozinha.md`](manual-cozinha.md), [`manual-dono.md`](manual-dono.md)

Cutover e DNS: [`B-010`](../BLOQUEIOS.md) — precisa de data com o Ridwan. O 1.0 fica **read-only** e
arquivado, **não se apaga durante 90 dias** (`CLAUDE.md §15`).

---

## 11. Registo de execução

| Fase | Data | Quem | Resultado |
|---|---|---|---|
| 0 · decisões | 22 Set | Gabriel | 0.1 resolvida (staging estava pausado, restaurado). 0.2 resolvida para o staging; **a do LIVE continua em falta**. 0.3 e 0.4 por decidir |
| 1 · staging | 22 Set | Gabriel + agente | ✅ Restaurado e migrado até à `1051`. B-110 fechado: `pos-card-login` 11/11. Fotos da `1042` confirmadas |
| 2 · gate + main | 22 Set | Gabriel + agente | ⏳ Gate verde (91 ficheiros / 788 testes) e integração verde contra staging. **Falta o merge `dev` → `main`** |
| 3 · schema LIVE | 23 Set 00:20 | Gabriel + agente | ✅ 16 aplicadas (`1037`…`1052`). LIVE em **119 migrations**, lista idêntica ao repo. Fotos do cardápio corrigidas pela `1052` |
| 3 · schema LIVE (2.ª) | 23 Set 14:33 | Gabriel + agente | ✅ `1060` (promoções) e `1061` (esgotado no balcão). LIVE em **121 migrations**. Corpos das 7 funções novas conferidos por `md5` contra o repo: idênticos. `get_menu` das duas lojas responde pelo embrulho novo, sem campanha activa — e nenhuma pode activar nas lojas HAWSMASH, porque têm POS (`counter_enabled`) |
| 4 · equipa | | | ⏳ `scripts/criar-equipa.mjs` escrito e provado em staging. Espera a decisão 0.3 |
| 5 · Railway | | | ⬜ |
| 6 · verificação | | | ⬜ |

---

## 12. O que este plano assumia — e o que se soube depois

Resolvidas a 22 Set:

- ~~**"103 migrations no LIVE"** vem de uma nota~~ → **confirmado por consulta**: 103, última `1036`.
- ~~**O staging pode estar apagado**~~ → estava **pausado**. Caminho 1A, ref mantido.
- ~~**Os 108 commits nunca correram contra uma BD real**~~ → já correram. Dívida paga.

O que fica por saber, e onde pode doer:

- ~~**Não se sabe o estado dos privilégios do LIVE**~~ → medido na janela da Fase 3: a escrita directa
  à chave de serviço passou e normalizou o telefone. A `1051` está boa nos dois ambientes.
- **A password de BD do LIVE continua por obter** (decisão 0.2). Sem ela não há `supabase db push`
  contra produção, e as migrations tiveram de ser aplicadas uma a uma com correcção de registo a
  seguir. Funciona, mas é um passo manual a mais de cada vez — e um passo manual a mais é uma
  oportunidade a mais de enganar-se. Resolver isto antes da próxima janela.
- **A Fase 6 tem uma linha que ninguém testou sem hardware:** o alerta automático. A `1050` corrige a
  porta e há teste de integração, mas o envio de email a sério depende do SMTP estar configurado no
  ambiente de produção (Fase 5.2).
- **A conta de dono do LIVE não existe.** Até a Fase 4 correr, nada no LIVE se consegue verificar pelo
  painel — só por consulta à base de dados.
