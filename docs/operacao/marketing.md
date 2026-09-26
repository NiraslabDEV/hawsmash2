# Manual de marketing e rastreio

> Guia prático para o **dono do restaurante** configurar os IDs de Google e Meta no painel → **Marketing**
> (`/marketing`). A aba também aparece ao gerente, mas a configuração actual exige o perfil de dono na BD.
> Credenciais de servidor e execução periódica de conversões exigem configuração técnica adicional.

**Estado verificado documentalmente em 26/09/2026:** o código foi lido; nenhum ID real, envio às redes,
consentimento numa instalação publicada ou campanha de anúncios foi validado. O detalhe técnico está em
[Marketing](../modulos/marketing.md), os riscos na [auditoria](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec)
e a activação pendente em [BLOQUEIOS](../../BLOQUEIOS.md). Os passos dos painéis externos abaixo são a
orientação conservada no produto; os seus nomes de menus não foram novamente verificados nesta revisão.

---

## 1. O que isto faz (em 1 minuto)

O sistema regista passos do site — **viu o cardápio**, **adicionou ao carrinho**, **foi ao checkout**,
**comprou** — e relaciona os pedidos com a origem disponível. Com IDs e consentimento configurados,
também envia sinais às plataformas de anúncios. A atribuição mostra a origem associada a uma venda;
não prova quanto se vendeu por causa de um anúncio. Bloqueadores, rede e links sem parâmetros deixam
lacunas. A receita confirmada na Análise é a referência operacional.

| Plataforma | Para quê serve |
|---|---|
| **Google Tag Manager (GTM)** | "Caixa" que organiza todas as tags num só lugar (recomendado, opcional) |
| **GA4 (Google Analytics)** | Relatórios de visitas, funil e vendas |
| **Meta Pixel** | Anúncios no Facebook/Instagram + público de remarketing |
| **Google Ads** | Contar conversões (vendas) vindas dos anúncios do Google |

Não precisa de todas. Ligue apenas as que utiliza. Um ID vazio não activa o respectivo script directo;
se usar GTM, as tags definidas dentro desse container são geridas no próprio GTM.

---

## 2. Onde colar cada coisa

Painel → **Marketing**. Há dois blocos:

- **IDs de rastreio (públicos)** — colar e guardar. São "endereços", não segredos.
- **Tokens secretos (servidor)** — destinados a Meta CAPI / Google Ads. Aparecem mascarados (`••••1234`),
  mas o formulário actual recebe o valor completo no browser do dono. A máscara não é isolamento de
  servidor; ver a limitação na secção 7.

Depois de colar, clique **Guardar configuração**. O **Preview do dataLayer** mostra os IDs seleccionados;
não é um monitor de eventos enviados nem prova de recepção pelas redes.

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
Os relatórios internos do painel (**Análise**) usam medição própria e pedidos do servidor, funcionando
também sem aceitar esses scripts. O site usa cookies próprios de sessão e atribuição; “recusar” não
desactiva toda a medição interna. Esta é a descrição do comportamento, não uma validação jurídica da
política de privacidade da instalação.

---

## 5. Se usar GTM: configurar as tags lá dentro (uma vez)

O site empurra os eventos para o **dataLayer** com estes nomes:

`view_item_list` · `view_item` · `add_to_cart` · `begin_checkout` · `add_payment_info` · `purchase` · `generate_lead`

No GTM, crie um **Trigger** do tipo *Custom Event* para cada nome e ligue a uma tag:
- **GA4 Event** (envia ao GA4) — use os campos do `ecommerce` (value, transaction_id, items).
- **Meta Pixel** (via tag da comunidade) — evento `Purchase`, `AddToCart`, etc.
- **Google Ads Conversion** — gatilho `Custom Event = purchase`, value `{{dlv - ecommerce.value}}`,
  transaction_id `{{dlv - ecommerce.transaction_id}}`.

> **Sem GTM?** Não faz mal. Se deixar o GTM vazio mas preencher GA4 + Pixel + Ads, o site carrega esses
> scripts **diretamente**. O GTM só é preciso se quiser controlar tudo num painel visual.

---

## 6. Como testar que está a funcionar

1. **Preview do dataLayer** (na aba Marketing): confirme os IDs; este passo valida apenas a configuração.
2. **GA4 → Realtime**: abra o site noutro separador, aceite os scripts, adicione algo ao carrinho e confirme os eventos recebidos.
3. **Meta Pixel Helper** (extensão do Chrome): abra o site, veja se o Pixel dispara `PageView`/`AddToCart`.
4. **Google Tag Assistant**: valida GTM e tags do Google.
5. **Compra de teste em staging, com pagamento simulado**: leve um pedido até `pago/aprovado` e confirme
   um único `purchase` ao recarregar o acompanhamento. Submeter o checkout não equivale a pagar.
6. **Origem**: use um link com parâmetros de teste, confirme a campanha em Análise → Aquisição e
   compare com o pedido confirmado. Um pedido criado pelo POS, mesmo para entrega, não entra no funil online.
7. **Conversões de servidor**: com o responsável técnico, confirme a fila e a recepção nas redes.
   Existe código de envio, mas o scheduler e as credenciais da instalação têm de estar activos.

Registe ambiente, data e resultado. Os testes de código e a configuração de um ID não substituem este
ensaio. Uma falha de tracking não deve interromper uma venda.

---

## 7. Dúvidas comuns (FAQ)

**"Colei tudo mas não vejo nada nos relatórios."**
→ (a) Aceitou o aviso de cookies? (b) Esperou alguns minutos (GA4 normal demora, Realtime é imediato)?
(c) O ID está correto e do site certo? (d) Tem AdBlock ligado? Teste numa janela anónima sem extensões.

**"Preciso de GTM E GA4 ao mesmo tempo?"**
→ Se preencher GTM, configure GA4/Meta/Ads dentro desse container: o site dá prioridade ao GTM e não
carrega esses scripts directamente. Sem GTM, usa os IDs directos. Evite tags repetidas no próprio container.

**"A venda aparece duas vezes."**
→ O browser só emite `purchase` no acompanhamento em **pago/aprovado**, com protecção contra repetição.
O servidor também regista a compra e gere a fila de conversões. Compare o identificador da transacção e
as tags no destino; não conclua que houve duas vendas apenas por dois eventos recebidos.

**"O que é o token secreto (CAPI / Developer token)?"**
→ É uma credencial para envio a partir do servidor. O motor já tem fila e processamento para esse envio;
a entrega real depende das credenciais e da execução periódica. Colar apenas o Developer Token não
configura, por si só, toda a integração Google Ads. A activação é feita com o responsável técnico.

**"É seguro pôr o token no painel?"**
→ A implementação actual mascara o texto no ecrã, mas lê os tokens para o browser autenticado do dono.
Não se pode prometer que “nunca saem do servidor”. Esta limitação exige revisão técnica; não partilhe a
sessão do dono nem copie tokens para campos públicos. IDs como `GTM-…` e `G-…` são públicos e têm outra função.

**"Mudei de número de Pixel/Ads. Onde altero?"**
→ Na mesma aba **Marketing**, substitua e guarde. Para tokens, o formulário tem **Substituir**; coordene
a alteração com quem mantém a integração de servidor.

---

## 8. Checklist de activação

1. Entrar como dono e abrir **Marketing**.
2. Colar os IDs dos canais utilizados e escolher GTM ou carregamento directo.
3. **Guardar**.
4. Abrir o site, **Aceitar** cookies, fazer um teste, confirmar no **Realtime** do GA4 / **Pixel Helper**.
5. Registar a recepção dos eventos e validar separadamente as conversões de servidor, se forem utilizadas.

---

## 9. Anúncios do Meta — os parâmetros de URL

No Ads Manager → *Parâmetros de URL*, colar exactamente:

```
utm_source={{site_source_name}}&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
```

Assim cada anúncio aparece na **Análise → Aquisição** com o nome da campanha, numa linha só. O sistema
normaliza também formatos antigos. Um link sem informação de origem pode aparecer como Directo; não
redistribua essa receita por anúncios por suposição. Como o rastreio funciona por dentro: [Marketing](../modulos/marketing.md).

## 10. Campanhas de preço da loja

O motor tem regras de reajuste e desconto por prazo, mas os componentes de banner e preço de campanha
ainda não estão integrados na montra activa, e o campo de cupão permanece no checkout. Não activar nem
anunciar a funcionalidade como percurso pronto antes da integração e do ensaio completo. Esta campanha
de preço é diferente de comprar anúncios no Meta/Google e não substitui uma ferramenta de email marketing.
Ver [limites e critérios no módulo](../modulos/marketing.md).
