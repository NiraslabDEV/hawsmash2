# App iOS (iPhone)

A app iOS é um invólucro nativo ([Capacitor](https://capacitorjs.com)) que abre o próprio site em ecrã inteiro,
como a TWA do Android ([android.md](android.md)). Cada deploy do site actualiza a app no mesmo instante. Só se
envia versão nova à Apple para trocar o ícone, o nome, as permissões ou o código nativo.

| | Android | iOS |
|---|---|---|
| Invólucro | TWA (o Chrome) | WKWebView (Capacitor) |
| Compila-se | neste PC (`android/gerar.mjs`) | num Mac do GitHub (`.github/workflows/ios.yml`): ninguém precisa de ter um Mac |
| Conta | Google Play, 25 USD uma vez | Apple Developer Program, **99 USD por ano** |
| App do estafeta | sim | **não**: no iPhone o estafeta usa o PWA (ver abaixo) |

## O que existe no código

| Peça | Onde |
|---|---|
| Configuração (site, domínios permitidos, marca no user-agent) | `ios/capacitor.config.json` |
| Projecto Xcode | `ios/ios/App/` (gerado pelo Capacitor; ícone, splash, `Info.plist` já ajustados) |
| Ecrã sem rede | `ios/www/offline.html` (o Capacitor mostra-o quando o site não carrega) |
| Ícone 1024 e splash | `ios/recursos/` (gerados da logo da montra, sem transparência, como a Apple exige) |
| Capturas da loja | `ios/loja/` e `ios/capturas.mjs` |
| Exportação para a App Store | `ios/ExportOptions.plist` |
| Compilar e enviar | `.github/workflows/ios.yml` |
| Botão "Instalar" escondido dentro da app | `apps/web/lib/pwa/install.ts` (`isNativeShell`): a app acrescenta `RestaurantOS-iOS/1` ao user-agent |

Decisões já tomadas no projecto:
- **Só iPhone, só ao alto.** Com iPad, a Apple exige também capturas de iPad e revê a app no iPad.
- **O pagamento Paysuite fica dentro da app** (`allowNavigation` com `paysuite.tech`). O resto (WhatsApp,
  mapas, telefone) abre na app própria do iPhone.
- **Câmara e fotos** têm texto de permissão: o comprovativo de pagamento sobe pelo checkout. Sem esses textos,
  a app fecha ao tocar em "carregar comprovativo".
- **Comida paga por M-Pesa não passa pela compra dentro da app da Apple** (bens físicos), nem pelos 30%.

## Documentos para a conta Apple (em nome do HAWSMASH)

A conta abre-se em [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/), de
preferência no app **Apple Developer** num iPhone. A primeira decisão é o tipo de conta:

| Se o HAWSMASH está registado como… | Conta | Nome que aparece na App Store |
|---|---|---|
| **Sociedade** (Lda, SA…) | **Organização** | HAWSMASH (o nome legal da empresa) |
| Empresário em nome individual, ou sem registo | Individual | o nome pessoal do titular (ex.: o do Ridwan) |

Para a **conta de organização** é preciso:

1. **Número D-U-N-S** da empresa. É gratuito e pedido à Dun & Bradstreet pela
   [página da Apple](https://developer.apple.com/enroll/duns-lookup/). Primeiro procurar: a empresa pode já ter
   um. Pode levar **até 2–4 semanas** a sair, por isso é o primeiro passo. Para o pedir:
   - nome legal **exacto** da empresa, como no registo comercial (não a marca, se for diferente);
   - morada da sede, telefone e NUIT;
   - **certidão de registo comercial** (a D&B ou a Apple podem pedi-la para confirmar);
   - nome e contacto de quem pede.
2. **Quem inscreve tem de poder vincular a empresa**: o dono, sócio-gerente ou um director. Na prática, o
   Ridwan, ou alguém com autorização escrita dele.
3. **Apple Account** dessa pessoa com **verificação em dois passos**. Recomenda-se um email do domínio
   (ex.: `app@hawsmash.com`) e não um Gmail pessoal: a conta fica da empresa, não de uma pessoa.
4. **Site público no domínio da empresa**: `hawsmash.com` já cumpre.
5. **Documento de identificação** do Ridwan (BI ou passaporte): o app Apple Developer pode pedir uma foto
   para verificar a identidade.
6. **Cartão para pagar 99 USD por ano**, aceite em pagamentos internacionais. Renova-se sozinho; se
   expirar, a app sai da loja.
7. **Telefone atento**: a Apple costuma ligar ou mandar email para confirmar os dados. Responder depressa
   encurta o processo, que normalmente leva de 2 dias a 2 semanas depois do D-U-N-S.

Para a **conta individual**: Apple Account com dois passos, documento de identificação e cartão. Não precisa
de D-U-N-S e sai em 1–2 dias, mas a loja mostra o nome da pessoa.

**Depois de aprovada**, o Ridwan convida a Niraslab em *App Store Connect → Utilizadores e acesso* com o perfil
**Admin**. Assim tratamos de tudo sem a senha dele.

## Pôr no ar, por ordem

1. **Conta Apple aprovada** e a Niraslab convidada como Admin.
2. **Criar a app** em *App Store Connect → Apps → +*: plataforma iOS, nome **HAWSMASH**, língua principal
   português, bundle ID `com.hawsmash.app` (se não aparecer na lista, registar primeiro em
   *Certificates, IDs & Profiles → Identifiers*). O bundle ID **não muda** depois de publicado.
3. **Chave da API** em *Utilizadores e acesso → Integrações → App Store Connect API → +*, com o perfil **Admin**
   (só o Admin deixa a Apple criar os certificados de assinatura sozinha). Descarregar o `.p8`: **só se
   descarrega uma vez**. Guardar no gestor de senhas.
4. **Segredos no GitHub** (*Settings → Secrets and variables → Actions*):

   | Segredo | Onde está |
   |---|---|
   | `APPLE_TEAM_ID` | developer.apple.com → *Membership details* → Team ID (10 caracteres) |
   | `ASC_KEY_ID` | a coluna *Key ID* da chave criada no passo 3 |
   | `ASC_ISSUER_ID` | o *Issuer ID* no topo da mesma página |
   | `ASC_KEY_P8` | o conteúdo inteiro do ficheiro `.p8`, incluindo as linhas `BEGIN`/`END` |

5. **Actions → iOS → Run workflow**, com *enviar* ligado. Ao fim de ~15 min a build aparece no **TestFlight**.
6. **Testar no iPhone** pelo TestFlight (tu, o Ridwan e a equipa): pedido completo, pagamento Paysuite,
   comprovativo com a câmara, WhatsApp, modo avião (deve aparecer o ecrã "Sem ligação").
7. **Ficha da loja** (tabela abaixo) e **Submeter para revisão**. A revisão leva normalmente 1–3 dias.

O workflow corre sozinho, só a compilar (sem enviar), sempre que `ios/` muda em `dev` ou `main`. É a prova de que
o projecto Xcode está são antes de haver conta.

**Versão nova:** *Run workflow* com *versao* (ex.: `1.0.1`). O número de build sobe sozinho.

## Ficha da App Store

| Campo | Valor |
|---|---|
| Nome (máx. 30) | HAWSMASH |
| Subtítulo (máx. 30) | Smash burgers em Maputo e Matola |
| Categoria | Comida e bebida |
| Ícone | vem da build (`ios/loja/icone-1024.png`, para referência) |
| Capturas iPhone 6,9" (1320×2868, mín. 1, máx. 10) | `ios/loja/1-inicio.png`, `2-cardapio.png`, `3-carrinho.png` |
| Política de privacidade | `https://hawsmash.com/privacidade` |
| URL de suporte | `https://hawsmash.com` (ou a página de contacto) |
| Classificação etária | 4+ (sem conteúdo sensível) |
| Preço | Grátis |
| Países | começar por Moçambique (ver UE abaixo) |
| Conta de demonstração | não é precisa: comprar não exige login. Escrever nas notas para o revisor que pode montar um pedido sem pagar |

> `1-inicio.png` foi tirada fora do horário ("Fora do horário"). Repetir com a loja aberta:
> `cd ios && npm install && npm run capturas`.

**Privacidade da app** (questionário obrigatório): recolhe nome, telefone, email e morada para entregar o
pedido, ligados à pessoa, sem rastreio entre apps. Se o pixel/CAPI do Meta correr dentro da app, declarar
"Dados usados para rastreio" e avaliar o pedido de permissão do ATT. Sem isso, a revisão pode recusar.

**União Europeia:** quem distribui na UE tem de se declarar "comerciante" (DSA), e a morada e o telefone
ficam públicos na ficha. Disponibilizar só em Moçambique (e países vizinhos, se fizer sentido) evita isso.

## O risco da revisão (regra 4.2) e o que vem a seguir

A Apple recusa apps que sejam "só um site". A app já tem um ecrã nativo sem rede e permissões próprias. Contra a
recusa, o argumento forte são as **notificações push do estado do pedido** ("O teu pedido saiu para entrega").
Isso é o passo seguinte e exige:
- a chave **APNs** (*Certificates, IDs & Profiles → Keys*, com a conta aprovada);
- `@capacitor/push-notifications` no projecto iOS e o pedido de permissão no site, só dentro da app;
- uma migration com os tokens dos aparelhos por cliente/pedido e o envio quando `advance_order` muda o estado
  (best-effort, regra 1).

Se a primeira revisão recusar por 4.2, a resposta é essa entrega. Responder no Resolution Center a explicar
o fluxo de pedido e pagamento também costuma ajudar.

## Estafeta no iPhone

A App Store recusa apps só para funcionários de uma empresa. O estafeta abre `hawsmash.com/estafeta` no
**Safari** e usa Partilhar → "Adicionar ao ecrã principal" (a faixa do topo já o ensina). Desde o iOS 16.4,
o PWA no ecrã principal também recebe notificações. Se um dia for mesmo preciso nativo, a Apple tem a
distribuição **Unlisted** (link privado), que se pede à parte.

## Outra instalação (outro restaurante)

1. `ios/capacitor.config.json`: `appId`, `appName`, `server.url` e `allowNavigation`.
2. `PRODUCT_BUNDLE_IDENTIFIER` em `ios/ios/App/App.xcodeproj/project.pbxproj` e `CFBundleDisplayName` em
   `ios/ios/App/App/Info.plist`.
3. Ícone e splash novos em `ios/recursos/` e copiados para `ios/ios/App/App/Assets.xcassets/`.
4. Conta Apple **do cliente** e os quatro segredos no repositório da instalação.
