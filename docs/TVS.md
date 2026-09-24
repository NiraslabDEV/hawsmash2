# TVs da loja — senhas, vídeos e cardápio

> Aba **TVs** do painel · migration `1090_tvs_da_loja` · pedido do dono, 24 Set 2026.
> Contrato: `apps/web/lib/tv/settings.ts` (o painel grava e a TV lê com o mesmo `resolveTvConfig`).

## O que é

Cada ecrã físico é uma linha em `store_tvs`, com um **endereço próprio**:

```
https://<domínio>/tv/<loja>/<tv>        ex.: /tv/maputo/tv1
```

A box da TV abre esse endereço uma vez e nunca mais se mexe nela: **o painel manda no ecrã**.
A TV relê a sua configuração a cada 30 s. Mudar o modo, os vídeos ou os títulos chega em até 30 s.

Cada loja nasce com **duas TVs** (`tv1` = senhas + vídeos, `tv2` = só vídeos). Acrescentam-se mais
no botão **Adicionar TV** (até 20 por loja), ou com **Duplicar esta TV**.

| Modo | O que a TV mostra |
|---|---|
| **Senhas + vídeos** | vídeos em ciclo e uma coluna com as senhas prontas; a senha nova ocupa o ecrã uns segundos. Sem vídeos na lista, mostra só as senhas |
| **Só senhas** | senhas prontas em grande, em preparo por baixo |
| **Só vídeos** | vídeos e imagens em ciclo, ecrã inteiro. Sem vídeos, mostra o logótipo |
| **Cardápio** | preços e esgotados da loja, ao vivo |

As senhas são as de sempre: tudo o que fica `ready`, pela aba **Senhas** do POS ou pela seta do
quadro de **Pedidos** (1076). A TV nunca mostra nomes, telefones nem valores.

## O que se configura (tudo na aba TVs)

- **Identificação:** nome, endereço, ligada/desligada (desligada mostra só o logótipo).
- **Ecrã:** rotação (TV montada ao alto), tamanho do texto (70–160 %), barra de título, relógio.
- **Senhas:** título ("Pedido pronto"), texto sem senhas, título dos em preparo, segundos do destaque
  (0 = sem destaque), tirar da TV depois de N minutos (0 = até Entregue), máximo de senhas,
  tipo por baixo do número, toque de aviso, lado da coluna.
- **Vídeos:** lista por ordem (subir/descer/tirar), tempo por imagem, com/sem som, encher/mostrar inteiro.
- **Cardápio:** 1–3 colunas, esgotados à vista ou escondidos.

A pré-visualização ao lado do editor é a página da TV a sério (`?preview=1`), rodada como a TV está montada.
`?preview=1` não conta como TV ligada.

## Biblioteca de vídeos

- É **da empresa** (como o cardápio): carrega-se uma vez e usa-se em qualquer TV de qualquer loja.
- **Formatos:** vídeo MP4 (H.264) ou WebM; imagem JPG, PNG ou WebP. `.mov`/`.avi` são recusados à
  entrada — não tocam em todas as boxes Android.
- **Tamanho:** até 200 MB por ficheiro no bucket; o projecto Supabase pode ter um tecto global menor
  (B-113). Recomendado: 1080p, 20–60 s, < 50 MB.
- **Apaga** o dono, ou o gerente que carregou. As TVs que o tinham saltam-no sozinhas.
- Bucket `tv-media` público (a TV não tem sessão; vídeo promocional não é segredo). Escrita só dono/gerente.

### Cache na TV (porque é que isto não gasta a internet)

Cada ficheiro tem um endereço que nunca muda de conteúdo (`media/<uuid>.mp4`). A TV descarrega-o
**uma vez** para a Cache API do browser e toca a partir do disco (`lib/tv/media-cache.ts`). Sem isto,
um vídeo de 30 MB em ciclo o dia todo seria descarregado de novo a cada volta — dezenas de GB por dia
por TV no tráfego do Supabase. Efeito secundário: **sem internet, a TV continua a passar os vídeos**
que já tinha, e a última configuração fica em `localStorage`.

## Pôr uma TV a funcionar

1. Box Android (ou mini-PC) ligada à TV por HDMI, na rede da loja (ver `HARDWARE.md`, IP reservado).
2. Abrir o endereço da TV (botão **Copiar endereço** na aba).
3. Ecrã inteiro e arranque automático: **Fully Kiosk Browser** na box Android; Chrome/Edge com
   `--kiosk` num mini-PC.
4. **Som das senhas:** arrancar o browser com `--autoplay-policy=no-user-gesture-required`, ou
   carregar **OK** no comando uma vez depois de ligar (a TV mostra "Som das senhas desligado" até lá).
5. Na aba TVs, a TV passa a **Ligada** em menos de um minuto. "Sem sinal desde…" = a box está
   desligada, sem rede ou com o browser fechado.

A TV também apanha versões novas do sistema sozinha (`/api/version`, o mesmo travão do POS:
no máximo um recarregar a cada 10 minutos, nunca a meio de um anúncio de senha).

## Rotas antigas

`/tv/<loja>/senhas` e `/tv/<loja>/menu` continuam a funcionar com os valores de fábrica, para as
boxes que já apontam para lá. Para passar a configurar no painel, abre na box o endereço da TV.

## Segurança e auditoria

- `store_tvs` e `tv_media`: RLS, sem `using (true)`; escrita só por RPC. A Matola não lê nem muda
  as TVs de Maputo, e uma TV não muda de loja (`tv_denied`).
- `get_tv_screen` é a única porta pública: devolve a configuração da TV e **só** os ficheiros que
  ela passa. Bate o coração (`last_seen_at`) no máximo a cada ~25 s.
- `event_log`: `store.tv_created`, `store.tv_saved` (com as secções que mudaram), `store.tv_deleted`,
  `tv.media_added`, `tv.media_deleted`.
- Gate: `packages/db/tests/tvs.test.ts`; domínio: `apps/web/lib/tv/__tests__/`.
