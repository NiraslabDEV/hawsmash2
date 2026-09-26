# TVs, senhas e KDS

As TVs mostram informação pública da loja: senhas, vídeos/imagens e cardápio. O painel configura cada ecrã físico. O **KDS de cozinha continua planeado** em G2 do [ROADMAP](../../ROADMAP.md); não existe uma página KDS implementada. O quadro de pedidos do POS não deve ser apresentado como essa entrega.

**Estado:** código observado na árvore de 26/09/2026, sem consulta às boxes ou a produção. A migration 1090 implementa as TVs configuráveis; equipamento, som, cache e limite efectivo de upload exigem validação da instalação.

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
| Senhas + vídeos | Ciclo de media e coluna das senhas prontas, com destaque temporário da nova senha; sem media, mostra senhas |
| Só senhas | Prontas em grande e pedidos em preparo abaixo |
| Só vídeos | Media em ecrã inteiro; sem playlist, logótipo |
| Cardápio | Produtos, preços e disponibilidade da loja |

As senhas prontas vêm dos pedidos em `ready`, após chamada na aba Senhas do POS ou avanço do pedido. **As vistas de senhas** não mostram nomes, telefones nem valores. O modo Cardápio mostra preços dos produtos.

A TV relê a configuração a cada 30 s e conserva uma cópia local. O polling da fila de senhas é de 5 s; o cardápio refresca a cada 60 s. Uma falha mantém o último conteúdo disponível; não transforma a TV numa fonte de estado de pedido. Os vídeos já guardados podem continuar sem internet, mas as senhas deixam de ter actualizações novas.

## O que se configura

- Nome, slug/endereço e ligada/desligada; desligada mostra o logótipo.
- Rotação, escala de texto entre 70 e 160%, barra de título e relógio.
- Títulos/textos das senhas, tempo de destaque, expiração das prontas, máximo visível, tipo sob o número, som e lado da coluna. Zero no destaque desliga-o; zero na expiração mantém até Entregue.
- Playlist ordenada, duração de imagens, som de vídeo e ajuste preencher/conter.
- Cardápio com uma a três colunas e opção de mostrar esgotados.

A pré-visualização usa a página real com `?preview=1`, incluindo a rotação. Essa consulta não actualiza o heartbeat. A leitura normal actualiza `last_seen_at`, limitada na BD a aproximadamente 25 s; o painel considera o ecrã online dentro da janela definida no contrato de TV.

## Biblioteca e cache

O bucket público `tv-media` guarda media promocional, não dados de clientes. Upload aceita MP4/WebM, JPEG/PNG/WebP; `.mov` e `.avi` são recusados. O limite declarado é 200 MB por ficheiro, mas o projecto Supabase pode impor um limite global menor (**B-113**). O guião original recomenda 1080p, duração de 20–60 s e menos de 50 MB; a compatibilidade do codec continua a depender da box.

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
