# Preparação de e-Mola directo

O caminho pedido é **e-Mola directamente com a Movitel**, ao lado de M-Pesa
directo. A preparação directa não requer conta, chaves nem serviços Paysuite.
O adaptador real Movitel ainda não está implementado: falta o contrato técnico.

## O que está preparado

| Configuração da loja | M-Pesa | e-Mola |
|---|---|---|
| `payment_provider=mpesa`, `emola_provider=manual` | Directo | Comprovativo |
| `payment_provider=mpesa`, `emola_provider=emola` | Directo | Integração pendente; checkout oferece comprovativo |
| `payment_provider=mpesa_sim`, `emola_provider=emola_sim` | Simulação M-Pesa | Simulação directa e-Mola |

O dono escolhe **Lojas → Pagamento → e-Mola online**. `emola` está reservado para
a integração directa e recusa iniciar pagamentos, na API e na RPC da BD, até o
adaptador real existir. Nenhum endpoint, mecanismo de autenticação ou segredo
Movitel foi inventado. `emola_sim` serve desenvolvimento/teste e é recusado pelo
servidor em produção. A migration não muda a configuração de lojas existentes.

O motor mantém compatibilidade com `paysuite`, `mock` e a herança `null` para outras
instalações. Esses modos não fazem parte da ligação directa e-Mola. Numa loja
M-Pesa directa, `null` mantém e-Mola por comprovativo.

O checkout directo pede o número da carteira seleccionada. O normalizador e-Mola
valida apenas o formato móvel moçambicano; não confirma operadora, titular ou
existência da carteira. A autenticação do cliente e a eventual confirmação no
telemóvel dependem do contrato real Movitel. O site nunca pede o PIN da carteira.

## Tentativas e confirmação

- Preço recalculado na BD; método e loja resolvidos a partir da encomenda guardada.
- `clientCheckoutId` persistido antes do envio; a BD reutiliza a mesma encomenda
  para a mesma chave/loja/conteúdo. `claim_online_checkout` só inicia uma tentativa.
- Resultado incerto conserva a encomenda e a referência para acompanhamento;
  não se cancela nem se recomenda pagar outra vez por um timeout.
- Confirmação usa o método correcto e a chave de idempotência comum. Falha
  definitiva passa por `advance_order/PAYMENT_FAILED`, sem baixar um pedido pago.
- A referência conserva-se mesmo após falha, permitindo consultas repetidas.
  Uma nova compra após falha definitiva usa uma nova chave e encomenda.
- Configuração só pelo dono, auditada por loja; troca de fornecedor fica bloqueada
  com pagamentos digitais pendentes. Nenhum segredo é devolvido ao navegador.

O simulador não usa rede, não cobra e não envia PIN. O último dígito escolhe um
cenário sintético: 0–5 confirmado, 6–7 recusado, 8 pendente com confirmação na
consulta, 9 pendente. Devolve uma referência `SIM_EMOLA_*`, persistida na encomenda
e consultável noutro processo. Este formato não é um protocolo Movitel.

## O que falta para integrar de verdade — B-109

Obter da equipa comercial/técnica Movitel o acesso de comerciante por loja e o
contrato de integração: ambientes, autenticação, unidades monetárias, criação,
consulta, referências/idempotência, códigos definitivos, limites e recuperação
após timeout. Se houver callbacks, obter também assinatura e política de reenvio.
Confirmar condições comerciais directamente; integração directa não significa
uma tarifa publicada ou gratuita.

Na pesquisa de 2026-09-14 não encontrámos documentação técnica pública oficial
suficiente na [página e-Mola da Movitel](https://www.movitel.co.mz/digital-services/emola).
O [atendimento Movitel](https://www.movitel.co.mz/support/warranty-service-point)
indica a linha geral **100**. Isto não demonstra que a API não exista; a documentação
de comerciante tem de ser obtida. Não foram adoptadas APIs de intermediários.

Com esse contrato, implementar o adaptador real, armazenamento seguro das
credenciais e consulta/callback conforme documentado; só então retirar a guarda
`emola_direct_contract_unavailable` da API e da BD, por uma nova migration.
Portanto, a activação real ainda exige desenvolvimento e ensaio, além de credenciais.

## Validação e activação — B-108

Aplicar **1046, 1047 e 1048 primeiro em staging**, testar permissões owner/manager/anon,
isolamento por loja, repetição, falha, sucesso e confirmação tardia. Ensaiar depois
com o ambiente fornecido pela Movitel, incluindo interrupção entre envio e resposta.
Configurar a reconciliação (B-106) conforme os limites documentados.

Os testes locais cobrem domínio, configuração, handlers e navegador com dados
sintéticos. Os ensaios SQL embebidos estão em `docs/validation/`; os testes pgTAP
em `supabase/tests/` aguardam o stack Supabase real. Nenhuma cobrança real foi feita.

Limites: chave local ao navegador não identifica uma repetição noutro dispositivo;
processo interrompido após reclamar a tentativa pode exigir intervenção. Sem gravar
a referência do simulador pendente, não se infere pagamento. O cron conta falhas
definitivas mas a sua persistência automática e alertas continuam na etapa V3.

```sh
pnpm lint
pnpm test
pnpm exec playwright test --config playwright.payments.config.ts
```
