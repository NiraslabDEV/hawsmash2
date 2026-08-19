# Manual de Marketing & Rastreio (FASE 4)

> Guia prático para o **dono do restaurante** (ou quem gere o marketing) ligar Google e Meta ao site.
> Tudo se configura no painel: **Admin → Marketing**. Não é preciso programador nem mexer em ficheiros.

---

## 1. O que isto faz (em 1 minuto)

Sempre que um cliente usa o site, o sistema regista os passos dele — **viu o cardápio**, **adicionou ao
carrinho**, **foi ao checkout**, **comprou**. Esses sinais são enviados para as plataformas de anúncios para
você saber **quanto vendeu por causa de cada anúncio** e mostrar anúncios a quem já visitou.

| Plataforma | Para quê serve |
|---|---|
| **Google Tag Manager (GTM)** | "Caixa" que organiza todas as tags num só lugar (recomendado, opcional) |
| **GA4 (Google Analytics)** | Relatórios de visitas, funil e vendas |
| **Meta Pixel** | Anúncios no Facebook/Instagram + público de remarketing |
| **Google Ads** | Contar conversões (vendas) vindas dos anúncios do Google |

Você **não precisa de todas**. Pode ligar só a que usa. Campo vazio = não carrega nada.

---

## 2. Onde colar cada coisa

Painel → **Marketing**. Há dois blocos:

- **IDs de rastreio (públicos)** — colar e guardar. São "endereços", não segredos.
- **Tokens secretos (servidor)** — só para Meta CAPI / Google Ads avançado (FASE 4.5). Ficam mascarados (`••••1234`).

Depois de colar, clique **Guardar configuração**. O **Preview do dataLayer** mostra o que vai ser enviado.

---

## 3. Onde encontrar cada ID (passo a passo)

### 3.1 Google Tag Manager — `GTM-XXXXXX`
1. Aceda a [tagmanager.google.com](https://tagmanager.google.com/) e crie uma conta + container (tipo **Web**).
2. No topo, ao lado do nome do container, está o ID **`GTM-XXXXXX`**. Copie.
3. Cole no campo **Container ID**.
> Se usar GTM, ele passa a ser o "hub": as tags do GA4/Meta/Ads configuram-se **dentro** do GTM (ver secção 5).

### 3.2 GA4 — `G-XXXXXXXXXX`
1. [analytics.google.com](https://analytics.google.com/) → **Admin** (engrenagem) → **Data Streams** → o seu site.
2. No topo aparece **Measurement ID** = **`G-XXXXXXXXXX`**. Copie para o campo GA4.

### 3.3 Meta Pixel — `123456789012345`
1. [Events Manager](https://business.facebook.com/events_manager2/) → **Data Sources** → o seu Pixel.
2. O número grande por baixo do nome é o **Pixel ID**. Copie.

### 3.4 Google Ads — `AW-123456789` + Label
1. [ads.google.com](https://ads.google.com/) → **Goals → Conversions** → crie/abra uma conversão de **Compra**.
2. Em "Tag setup → Use Google Tag Manager" verá:
   - **Conversion ID** = `AW-123456789` → campo **Conversion ID**.
   - **Conversion Label** = `AbCdEfGhIjK` → campo **Conversion Label**.

---

## 4. Consentimento de cookies

O site mostra um aviso **"Aceitar / Recusar"**. Os scripts de Google/Meta **só carregam depois de "Aceitar"**.
Isto é de propósito (privacidade + regras dos browsers). Os relatórios internos do painel (**Análise**)
funcionam mesmo sem aceitar, porque usam dados próprios do servidor — não dependem de cookies de terceiros.

---

## 5. Se usar GTM: configurar as tags lá dentro (uma vez)

O site empurra os eventos para o **dataLayer** com estes nomes:

`view_item_list` · `add_to_cart` · `begin_checkout` · `add_payment_info` · `purchase` · `generate_lead`

No GTM, crie um **Trigger** do tipo *Custom Event* para cada nome e ligue a uma tag:
- **GA4 Event** (envia ao GA4) — use os campos do `ecommerce` (value, transaction_id, items).
- **Meta Pixel** (via tag da comunidade) — evento `Purchase`, `AddToCart`, etc.
- **Google Ads Conversion** — gatilho `Custom Event = purchase`, value `{{dlv - ecommerce.value}}`,
  transaction_id `{{dlv - ecommerce.transaction_id}}`.

> **Sem GTM?** Não faz mal. Se deixar o GTM vazio mas preencher GA4 + Pixel + Ads, o site carrega esses
> scripts **diretamente**. O GTM só é preciso se quiser controlar tudo num painel visual.

---

## 6. Como testar que está a funcionar

1. **Preview do dataLayer** (na tab Marketing): confirme que os IDs aparecem certos.
2. **GA4 → Realtime**: abra o site noutro separador, adicione algo ao carrinho — deve ver os eventos a entrar.
3. **Meta Pixel Helper** (extensão do Chrome): abra o site, veja se o Pixel dispara `PageView`/`AddToCart`.
4. **Google Tag Assistant**: valida GTM e tags do Google.
5. **Compra de teste**: faça um pedido até `pago/aprovado` e confirme um único `purchase` (não deve duplicar
   ao recarregar a página de estado do pedido).

---

## 7. Dúvidas comuns (FAQ)

**"Colei tudo mas não vejo nada nos relatórios."**
→ (a) Aceitou o aviso de cookies? (b) Esperou alguns minutos (GA4 normal demora, Realtime é imediato)?
(c) O ID está correto e do site certo? (d) Tem AdBlock ligado? Teste numa janela anónima sem extensões.

**"Preciso de GTM E GA4 ao mesmo tempo?"**
→ Não. Se puser GTM, configure o GA4 dentro do GTM e deixe... na verdade pode pôr os dois campos; o sistema
dá prioridade ao GTM (evita contar a dobrar). Recomendado: **ou** GTM **ou** os IDs diretos, não os dois a dobrar.

**"A venda aparece duas vezes."**
→ Não deve. O `purchase` só dispara quando o pedido está **pago/aprovado** e tem proteção contra recarregar a
página. Se mesmo assim duplicar, é quase sempre **duas tags a contar o mesmo** (ex.: GA4 direto + GA4 dentro do
GTM). Escolha um caminho só.

**"O que é o token secreto (CAPI / Developer token)?"**
→ É para envio **server-side** (a partir do nosso servidor, não do browser) — protege a medição contra iOS e
AdBlock. É opcional e entra em funcionamento na **FASE 4.5**. Pode deixar vazio por agora.

**"É seguro pôr o token no painel?"**
→ Sim. Os IDs públicos vão para o site (é o suposto). Os **tokens secretos nunca saem do servidor** — não
aparecem no código do site nem na resposta pública do cardápio.

**"Mudei de número de Pixel/Ads. Onde altero?"**
→ Mesma tab **Marketing**, substitua e guarde. Para tokens, clique **Substituir**.

---

## 8. Resumo para quem tem pressa

1. Abrir **Admin → Marketing**.
2. Colar os IDs que tiver (GA4 e Pixel já cobrem 90% dos casos).
3. **Guardar**.
4. Abrir o site, **Aceitar** cookies, fazer um teste, confirmar no **Realtime** do GA4 / **Pixel Helper**.
5. Pronto — sem tocar em código.
