# ADR 0003 — A conta do cliente vive no dispositivo, não no número de telefone

- Estado: aceite
- Data: 2026-08-31
- Decisores: Niraslab / HAWSMASH

## Contexto

O cliente pediu que a loja reconheça quem já comprou: a pessoa entra, o sistema sabe quem é, e não volta a
escrever nome nem morada — escolhe entre as moradas que já tem (`Casa`, `Trabalho`) ou acrescenta uma nova.
É um pedido acertado. Um checkout que obriga a reescrever a morada a cada encomenda perde vendas, e o
telefone é a única identidade que este público tem sempre à mão.

O caminho evidente seria estender o `identify_customer` que já existe: escrever o telefone, receber o
perfil. Foi por aí que a `(public)/CLAUDE.md §9` fechou a porta, e com razão:

> ❌ **NUNCA** devolver morada, comprovativo ou dados de pagamento na identificação soft (sem OTP) — quem
> souber o número veria PII alheia.

O risco não é abstracto. Num sistema de entregas, escrever o número de alguém e receber `Casa — Av. Julius
Nyerere 812` é dizer a um desconhecido onde essa pessoa dorme. Números de telefone circulam: estão em grupos
de WhatsApp, em recibos, em anúncios de venda. Tratá-los como uma credencial é tratá-los por aquilo que não
são.

Ao mesmo tempo, a alternativa canónica — código por SMS em cada entrada — traz dois custos que este negócio
não quer pagar: fricção num funil de hambúrgueres, e uma factura por mensagem que cresce com as vendas.

## Decisão

**A morada deixa de estar atrás do telefone e passa a estar atrás de uma prova de posse do dispositivo.**

1. **Vinculação pelo pedido.** No fim do primeiro pedido, `account_bind_device(order_id)` emite um token
   para o dispositivo. A prova é o UUID do pedido: quem o tem é quem o fez — foi o endereço que lhe demos
   depois de pagar. O token vai para um cookie **httpOnly**, que o JavaScript da página não lê.
2. **Sessão longa.** A partir daí `account_me(token)` devolve nome e moradas. Sem fricção, sem SMS, sem
   custo por utilizador. É isto que produz o "já estou logado" que o cliente pediu.
3. **Dispositivo novo.** `account_request_code` + `account_verify_code`, com o código a sair por email para
   o endereço que a pessoa deixou num pedido anterior. Quem não tem email faz um pedido normal e o
   dispositivo prende-se no fim.
4. **Um telefone sozinho continua a não valer nada.** `identify_customer` mantém-se como estava: resumos e
   mais nada. Nenhuma RPC devolve morada sem token.

Guardamos apenas o **hash** do token e do código (`private.secret_hash`). Uma fuga da base de dados não abre
sessão nenhuma, porque o segredo vive no cookie do cliente e em mais lado nenhum.

## Consequências

**A favor**

- O cliente tem o que pediu sem que uma morada fique acessível a quem sabe um número.
- Custo marginal zero por utilizador: o caso comum não envia mensagem nenhuma.
- O caminho de SMS fica preparado. Quando houver fornecedor, muda quem entrega o código — as RPCs, o cookie
  e o ecrã ficam iguais.
- A morada do primeiro pedido é guardada sozinha, com etiqueta `Casa`. A segunda encomenda é uma sequência
  de toques.

**Contra, e assumido**

- **Telemóvel novo sem email no histórico não entra.** Faz um pedido normal e fica ligado no fim. É um
  pedido com fricção, não uma porta fechada.
- **Um dispositivo partilhado partilha a conta.** Quem empresta o telemóvel empresta as moradas. Há `Não sou
  eu` no checkout, que revoga o dispositivo — mas quem não carregar fica com a sessão do dono. Aceitável num
  telemóvel pessoal, que é o caso real desta loja.
- **Limpar os dados do browser é perder a sessão.** Volta-se ao ponto 1 ou 3.
- Um telefone sozinho continua a não devolver moradas — por desenho. Quem quiser um "entrar só com o
  número" está a pedir exactamente o que este ADR recusa.

## Alternativas rejeitadas

- **Identificação soft com moradas** (escrever o telefone e receber tudo). Rejeitada: é a fuga de PII que a
  §9 já tinha fechado.
- **OTP por SMS em cada entrada.** Rejeitada para já: fricção em cada login e custo por mensagem, sem
  fornecedor contratado. Continua a ser o passo natural quando houver.
- **Conta Supabase Auth com email e senha.** Rejeitada: uma senha para comprar um hambúrguer é mais atrito
  do que valor, e o público desta loja identifica-se por telefone, não por email.

## Revisão

Rever quando houver fornecedor de SMS contratado, ou se aparecerem queixas de sessões partilhadas em
dispositivos comuns. Alterar esta decisão implica novo ADR.
