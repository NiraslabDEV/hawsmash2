# TVs, senhas e KDS

As TVs mostram informação pública da loja: senhas, vídeos/imagens e cardápio. O painel configura cada ecrã físico. O **KDS de cozinha continua planeado** em G2 do [ROADMAP](../../ROADMAP.md); não existe uma página KDS implementada. O quadro de pedidos do POS não deve ser apresentado como essa entrega.

**Estado:** código observado na árvore de 2/10/2026, sem consulta às boxes ou a produção. A migration 1090 implementa as TVs configuráveis; equipamento, som, cache e limite efectivo de upload exigem validação da instalação. As correcções de 27/09 (um clique para pôr media numa TV, pré-visualização ao vivo, ecrãs sem marketing) são de interface e de leitura: não alteram o contrato da 1090.

## Utilizadores, dados e endereços

`owner` e `manager` entram na aba `/tvs`. A configuração é por loja em `store_tvs`, sujeita a autorização de loja; não se pode mover uma TV para outra loja através da edição. A biblioteca `tv_media` é partilhada pela empresa. A TV lê sem sessão de staff.

| Rota | Uso |
|---|---|
| `/tv/[store]/[screen]` | TV configurada no painel, identificada pelo slug do ecrã |
| `/tv/[store]/senhas` | Ecrã de senhas com valores de fábrica |
| `/tv/[store]/menu` | Cardápio com valores de fábrica |

A configuração inicial prevê duas TVs por loja: a primeira com senhas e vídeos, a segunda só vídeos. O painel acrescenta ou duplica ecrãs, até 20 por loja. As rotas fixas antigas continuam a funcionar; para controlar a box pelo painel é preciso apontá-la para o endereço de um ecrã configurado.

## Modos e fluxo

| Modo | Resultado |
|---|---|
| Senhas + vídeos | Ciclo de media e coluna das senhas prontas, com destaque temporário da nova senha. **Sempre dividido**: sem nenhum ficheiro, o lado da media mostra a marca, em vez de as senhas ocuparem o ecrã todo |
| Só senhas | Prontas em grande e pedidos em preparo abaixo |
| Só vídeos | Media em ecrã inteiro; sem playlist, logótipo |
| Cardápio | Produtos, preços e disponibilidade da loja |

As senhas prontas vêm dos pedidos em `ready`, após chamada na aba Senhas do POS ou avanço do pedido. **As vistas de senhas** não mostram nomes, telefones nem valores. O modo Cardápio mostra preços dos produtos. A lista de pedidos em preparo tem tecto — 20 no ecrã inteiro, 10 na coluna — e remata com «+N»: um pedido esquecido em preparo não enche a TV.

**Nas TVs e no KDS não há marketing.** `/tv` e `/kds` (e também `/pos`) não pedem a configuração de consentimento, não mostram o aviso de cookies e não iniciam nenhuma etiqueta: o aviso ficava por cima das senhas sem ninguém para o fechar, e cada volta da TV contava como uma visita da loja online nos pixels. A regra está num sítio só, [`lib/analytics/surfaces.ts`](../../apps/web/lib/analytics/surfaces.ts), com teste; o `AnalyticsProvider` continua montado em todas as páginas.

A TV relê a configuração a cada 30 s e conserva uma cópia local. O polling da fila de senhas é de 5 s; o cardápio refresca a cada 60 s. Uma falha mantém o último conteúdo disponível; não transforma a TV numa fonte de estado de pedido. Os vídeos já guardados podem continuar sem internet, mas as senhas deixam de ter actualizações novas.

## O que se configura

- Nome, slug/endereço e ligada/desligada; desligada mostra o logótipo.
- Rotação, escala de texto entre 70 e 160%, barra de título e relógio.
- Títulos/textos das senhas, tempo de destaque, expiração das prontas, máximo visível, tipo sob o número, som e lado da coluna. Zero no destaque desliga-o; zero na expiração mantém até Entregue.
- Playlist ordenada, duração de imagens, som de vídeo e ajuste preencher/conter.
- Cardápio com uma a três colunas e opção de mostrar esgotados.

A pré-visualização usa a página real com `?preview=1`, incluindo a rotação. Essa consulta não actualiza o heartbeat. A leitura normal actualiza `last_seen_at`, limitada na BD a aproximadamente 25 s; o painel considera o ecrã online dentro da janela definida no contrato de TV.

**A miniatura mostra o rascunho, não o gravado.** O painel envia o que está a ser editado ao iframe por `postMessage` — mesma origem, só com `?preview=1` — e a TV desenha-o na hora. **A TV da loja só muda ao Guardar**, e o texto por baixo da miniatura di-lo quando há alterações por guardar. O contrato do rascunho está em [`lib/tv/preview.ts`](../../apps/web/lib/tv/preview.ts), com testes: mensagens de outra origem são ignoradas e um rascunho estragado cai em valores seguros. O resultado de Guardar, e os erros, aparecem também na barra de guardar — não só no topo da página, que com a página a descer não se via.

## Biblioteca e cache

O bucket público `tv-media` guarda media promocional, não dados de clientes. Upload aceita MP4/WebM, JPEG/PNG/WebP; `.mov` e `.avi` são recusados. O limite declarado é 200 MB por ficheiro, mas o projecto Supabase pode impor um limite global menor (**B-113**). O guião original recomenda 1080p, duração de 20–60 s e menos de 50 MB; a compatibilidade do codec continua a depender da box.

**Pôr um ficheiro numa TV é um clique.** Na biblioteca, cada ficheiro tem um botão por TV da loja (`+ TV 1` / `✓ TV 1`): um clique põe-no ou tira-o dessa TV e **grava logo**, avisando se a TV está num modo que não passa media. No editor da TV, «Carregar vídeo ou imagem para esta TV» carrega, junta à lista e grava. O cartão de cada TV diz «N vídeos/imagens a passar», ou avisa que não tem nenhum. Antes, carregar punha o ficheiro só na biblioteca e juntá-lo à TV era um segundo passo escondido — a TV ficava vazia depois de três gravações. Guardar, `+ TV` e carregar passam todos pelo mesmo caminho de gravação, e a lista é limpa contra a biblioteca mais recente. Uma imagem sozinha fica no ecrã, em vez de piscar a cada 10 s.

O dono pode apagar media; o gerente só pode apagar o que carregou. Ao retirar um ficheiro, as TVs que o referenciam deixam de o apresentar. O upload e o registo em BD são operações distintas, com tentativa de limpeza do objecto quando o registo falha.

Cada objecto recebe um caminho por UUID cujo conteúdo não deve ser substituído. A Cache API guarda-o no dispositivo e a reprodução usa uma URL local. A cache reduz downloads repetidos; não é garantia de retenção ilimitada, pois o browser pode limpar armazenamento. A configuração usa `localStorage`. A biblioteca e o contrato estão em [media](../../apps/web/lib/tv/media.ts), [cache](../../apps/web/lib/tv/media-cache.ts) e [settings](../../apps/web/lib/tv/settings.ts).

## Contratos e eventos

| RPC | Chamador / finalidade |
|---|---|
| `get_tv_screen` | TV pública: configuração e media dessa playlist; heartbeat opcional |
| `get_store_queue` | Vistas públicas de senhas |
| `get_store_board` | Cardápio público da TV |
| `save_store_tv`, `delete_store_tv` | Painel, dono/gerente autorizado à loja |
| `register_tv_media`, `delete_tv_media` | Biblioteca, com regras de autor para apagar |

Os eventos são `store.tv_created`, `store.tv_saved`, `store.tv_deleted`, `tv.media_added` e `tv.media_deleted`. Guardam contexto da acção; alterações de configuração registam as secções modificadas. Consultar o [catálogo de eventos](../referencia/eventos.md) e a [matriz RLS](../referencia/tabelas-rls.md).

Fontes: [painel TVs](<../../apps/web/app/(admin)/tvs/>), [ecrãs públicos](<../../apps/web/app/(tv)/tv/>), [migration 1090](../../supabase/migrations/20260924120000_1090_tvs_da_loja.sql). Não há escrita de estado de pedidos a partir da TV.

## Instalação e validação

Ligar box/mini-PC por HDMI e à rede, abrir o endereço copiado do painel e configurar ecrã inteiro/arranque automático conforme [hardware](../operacao/hardware.md). O guião existente admite browser de quiosque na box e Chrome/Edge com modo quiosque no PC. O som depende da política de autoplay: é preciso uma interacção inicial ou configuração própria do browser. O ecrã indica quando o som está bloqueado.

O auto-update consulta `/api/version`; a TV não recarrega a meio de um destaque de senha e aplica o travão de um reload por dez minutos. “Sem sinal” pode significar falta de rede, browser fechado ou box desligada; o indicador não diagnostica qual deles.

[tvs.test.ts](../../packages/db/tests/tvs.test.ts) cobre permissões e RPCs; [testes de TV](../../apps/web/lib/tv/__tests__/) cobrem resolução da configuração e media. Existência destes testes não prova ensaio em hardware. Conferir **B-011** (TVs) e **B-113** (upload) em [BLOQUEIOS](../../BLOQUEIOS.md). A separação por loja deriva do [ADR 0001](../decisions/0001-multi-unidade.md); ainda não há ADR próprio para biblioteca/cache de TVs.

As permissões da cozinha e os valores acessíveis noutros caminhos têm discrepâncias em [auditoria, secção 5](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec). A ausência de KDS é uma entrega planeada, não uma autorização para dar acesso irrestrito ao painel.

---

## Contrato preservado da spec

KDS continua planeado: a rota da tabela seguinte não existe. As variantes de TV implementadas estão acima; o ensaio físico permanece pendente.

## 14. TVs

| Ecrã | Rota | Fase |
|---|---|---|
| **TV configurada no painel** (senhas + vídeos · só senhas · só vídeos · cardápio) | `/tv/[store]/[tv]` | **1** |
| **Menu board** (cardápio na parede, preços e esgotados ao vivo) | `/tv/[store]/menu` | **1** |
| **Senhas** (número do dia chamado quando fica `ready`) | `/tv/[store]/senhas` | **1** (barato, grande impacto no balcão) |
| **KDS** (ecrã de cozinha com colunas e temporizador) | `/kds/[store]` | **2** |

Regras: sem interacção, auto-refresh resiliente (reconecta sozinho), fullscreen, legível a 4 m, e **funciona
mesmo que o backend esteja lento** (mostra o último estado conhecido em vez de ecrã em branco).

**Aba TVs (1090).** Cada ecrã é uma linha em `store_tvs` (da loja, Regra 3), com endereço próprio. O modo,
os títulos e tempos das senhas, a rotação e a **lista de vídeos** configuram-se no painel pelo `owner`/`manager`
e chegam à TV em até 30 s, com `event_log`. Duas TVs por loja de fábrica; acrescentam-se mais no painel.
A biblioteca de vídeos (`tv_media`, bucket `tv-media`) é da empresa; a TV guarda cada vídeo em cache e continua
a passá-lo sem internet. `/menu` e `/senhas` ficam com os valores de fábrica. Detalhe em [`docs/modulos/tvs-kds.md`](tvs-kds.md).
