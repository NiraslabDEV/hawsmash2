# Preparação de e-Mola online

O e-Mola tem uma escolha própria por loja e pode coexistir com M-Pesa directo.
O caminho preparado usa o adaptador Paysuite já existente. Não foi inventado um
protocolo de cobrança directo da Movitel nem activada uma conta real.

## Configuração

| Configuração da loja | M-Pesa | e-Mola |
|---|---|---|
| `payment_provider=mpesa`, `emola_provider=null` | Directo | Comprovativo |
| `payment_provider=mpesa`, `emola_provider=paysuite` | Directo | Checkout Paysuite |
| `payment_provider=mpesa_sim`, `emola_provider=mock` | Simulação directa | Simulação do checkout |
| `payment_provider=paysuite`, `emola_provider=null` | Paysuite | Paysuite existente |
| `emola_provider=manual` | Segue a configuração principal | Comprovativo |

`null` preserva a compatibilidade das lojas que já usam Paysuite. Nas lojas com
M-Pesa directo, aplicar a migration não activa e-Mola automático.

O dono configura **Lojas → Pagamento → e-Mola online**. O caminho adicional
`emola_provider=paysuite` exige a chave e o segredo do webhook da própria loja;
não herda silenciosamente credenciais globais. O painel mostra apenas se cada
segredo está preenchido, e permite substituí-lo. Nunca devolve o valor guardado.

## Percurso preparado

1. O checkout apresenta os métodos compatíveis com a configuração daquela loja.
2. e-Mola segue para o checkout do fornecedor, sem normalizar o telefone como M-Pesa.
3. A API calcula o preço na BD e resolve o fornecedor pelo método do pedido.
4. Webhook, verificação activa e reconciliação usam a loja e o método gravados.
5. O webhook valida a assinatura, a referência, o valor e o método antes de confirmar.
   A confirmação conserva a chave de idempotência comum do pedido.

Antes do primeiro envio, o navegador persiste um `clientCheckoutId` e um resumo
SHA-256 do conteúdo. A BD reutiliza o pedido para a mesma chave/loja/conteúdo e
recusa reutilizar a chave para outros dados. `claim_online_checkout` permite que
uma única chamada inicie o fornecedor; repetições recuperam o URL ou o estado
pendente da mesma tentativa. O identificador e o resumo não contêm dados do cliente.

Uma configuração ausente antes da criação permite usar comprovativo. Se já existe
encomenda e a resposta é incerta, o cliente acompanha essa referência; não se cancela
nem se recomenda pagar novamente por um simples timeout. A chave persistida é
local ao navegador: outro dispositivo, armazenamento apagado ou conteúdo diferente
representam uma nova tentativa, não uma repetição identificável pelo servidor.

Trocar gateways enquanto existem pagamentos digitais pendentes fica bloqueado;
corrigir credenciais continua possível. O acesso directo de escrita a `stores` é
revogado para clientes autenticados: a configuração passa pelas RPCs com permissões
e auditoria. Falhas definitivas confirmadas usam `advance_order/PAYMENT_FAILED`,
reservado ao servidor, sem baixar o estado de um pedido já pago.

## Activação real, por instalação

1. Aplicar as migrations **1046 e 1047 primeiro em staging**, testar permissões e isolamento
   por loja; só depois publicar o código que lê a nova coluna.
2. Confirmar que a conta Paysuite está habilitada para e-Mola e inserir as credenciais
   da loja. Configurar `APP_BASE_URL` com o domínio HTTPS da instalação.
3. Configurar o callback `/api/webhooks/paysuite`, validar HMAC e reenvios no ambiente
   de ensaio; configurar o scheduler privado da reconciliação conforme o plano de volume.
4. Ensaiar sucesso, recusa, timeout, confirmação tardia e callback repetido, verificando
   que existe uma única confirmação e que a conta da outra loja nunca é usada.

Sem estes ensaios, o código está preparado, mas não se declara e-Mola activo em produção.
As condições da conta e a API devem ser confirmadas com o fornecedor. Referência técnica:
[documentação oficial Paysuite](https://paysuite.tech/docs/), consultada em 2026-09-14.

## Limites e validação

Verificação local em 2026-09-14: 681 testes, lint/typecheck e build do motor passaram;
13 testes de navegador passaram com pagamentos simulados. Foram executados 36 casos
SQL da 1046 e 22 da 1047 em PostgreSQL embebido. Os relatórios e limites do SQL estão
em `docs/validation/`; não equivalem a validação de staging ou de cobranças reais.

- Se a resposta de criação ou a gravação do ID se perder, um callback assinado pode
  recuperar a referência de uma tentativa iniciada, após validar pedido/valor/método.
  Sem callback nem ID, é necessária intervenção com o fornecedor; o sistema mantém
  a tentativa pendente e não reinicia uma cobrança incerta. Não há pesquisa automática
  por extracto. Uma falha do processo depois de reclamar a tentativa e antes de contactar
  o fornecedor também fica pendente para intervenção, sem repetição cega.
- Não mudar a conta destinatária ao corrigir credenciais com pagamentos pendentes.
  Rotação de uma chave da mesma conta e troca de conta são operações distintas.
- O cron sinaliza `providerFailed`; persistência automática desse resultado e alertas
  de operação continuam em V3. Webhook e verificação activa já usam a transição comum.
- Testes de domínio/configuração/handlers usam dados sintéticos. O ensaio de navegador
  usa RPCs e pagamentos simulados. O ensaio SQL embebido não substitui o stack Supabase
  com as policies, triggers e PostgREST da instalação.

Comandos locais, sem gateway:

```sh
pnpm lint
pnpm test
pnpm exec playwright test --config playwright.payments.config.ts
```

Os testes SQL de staging estão em `supabase/tests/`. Os bloqueios
de activação são B-108/B-109 no `BLOQUEIOS.md`.
