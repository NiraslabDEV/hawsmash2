# Manual do balcão — HAWSMASH

> Para quem está na caixa. Confirmar este procedimento no terminal da loja durante a formação.
> Regra que manda em tudo: **a venda nunca pára**. Se algo falhar, continua a vender e avisa o gerente.

---

## 1. Começar o turno

1. Liga o PC do balcão. Se o arranque automático já estiver configurado, o **POS** abre em ecrã inteiro.
2. Toca no **cartão com o teu nome** e escreve o teu **PIN de 4 a 6 dígitos**. Nunca uses o cartão de outra pessoa.
3. Se o terminal ainda não estiver preparado, chama o gerente. Email/palavra-passe servem a configuração
   inicial do terminal e do PIN; não são o percurso normal de entrada diária.
4. Confirma no topo do ecrã que diz a **tua loja** (Maputo ou Matola). Se disser a outra, chama o gerente — não vendas.
5. **Abre o caixa:** aba **Caixa** (barra da esquerda) → conta o troco da gaveta → escreve o valor → **Abrir caixa**.

O POS **não pergunta a loja**: o computador já sabe qual é. Isso evita mandar pedidos para a cozinha errada.

---

## 2. Vender (menos de 15 segundos)

1. Toca nas **categorias** em cima e depois no **produto**.
2. Cada toque adiciona 1. Para tirar, usa o **−** no carrinho da direita.
3. Item a cinzento com **ESGOTADO** não se vende — está sem stock nessa loja.
4. Toca em **FINALIZAR VENDA**.

### Pagamento
| Forma | O que fazer |
|---|---|
| **Dinheiro** | Toca em `Recebido:` e escreve o valor que o cliente deu. O **troco aparece em grande**. |
| **M-Pesa / e-Mola** | Confirma no telemóvel da loja que o dinheiro entrou **antes** de finalizar. |
| **Cartão** | Passa no terminal do banco e só depois finaliza. |
| **Misto** | Liga o modo misto e reparte os valores até somar o total. |

Ao finalizar, confirma no ecrã que a venda ficou registada e lê a **senha do dia**. Com dinheiro, confere
o troco devolvido pelo sistema e toca em **OK** depois de o entregar. As vias saem conforme a configuração
da loja e a gaveta deve abrir se houve dinheiro. Se o papel falhar, não repitas a venda: chama o gerente
para verificar a fila/reimprimir. Com duas vias, a de controlo fica no balcão e a do cliente sai na cozinha.

---

## 3. Quando a internet cai

O POS mostra em cima: **`SEM LIGAÇÃO · N vendas por sincronizar`**.

- Continua as **vendas de balcão**, se o POS já estiver aberto com o menu disponível. Mesas, entrega,
  entrada de outra pessoa e operações de caixa precisam de ligação.
- O POS tenta imprimir pela ligação local ao bridge. Funciona sem internet quando PC, impressora,
  rede local/configuração estiverem disponíveis; a falta de papel ou avaria continuam possíveis.
- Quando a internet voltar, aparece uma confirmação **verde**: as vendas subiram sozinhas.
- **Não cries outra venda** porque "parece que não passou". O retry da mesma venda conserva a chave;
  uma venda nova pode cobrar novamente. Se houver dúvida, chama o gerente para conferir.
- Não limpes dados do navegador, não reinstales o POS e não desligues o PC enquanto houver vendas por subir.

Se a impressora também estiver em baixo: a venda **grava na mesma**. Escreve o número numa folha e entrega ao cliente.

---

## 4. Enganos

- **Errar item antes de finalizar** → ajusta no carrinho.
- **Venda já finalizada** → só o **gerente** anula, e tem de escrever o motivo. Chama-o.
- **Segunda via do talão** → botão **Reimprimir** (ou `F2` para o último). Fica registado quem reimprimiu.
- **Abrir a gaveta fora de uma venda** → só com gerente. Fica registado quem abriu e porquê.

---

## 5. Caixa: turnos, sangria e fecho do dia

Tudo no POS, aba **Caixa** (barra da esquerda). Precisa de internet — se a rede cair,
continua a vender e fecha quando voltar.

O dia faz-se assim: **abre o turno → fecha o turno → a pessoa seguinte abre o dela → fecha →
no fim de tudo, fecho do dia.**

- **Sangria** (dinheiro para o cofre), **despesa** (pagaste algo com dinheiro da gaveta), **reforço** ou
  **troco inicial**: toca em **Sangria · reforço · despesa**, escolhe o tipo, escreve o valor e o motivo.
  Fica registado quem lançou.

### Fechar o turno (troca de turno)

1. Aba **Caixa** → **Fechar turno**.
2. Conta o dinheiro **físico** da gaveta e escreve o valor contado.
3. O sistema mostra o **esperado** e a **diferença**. Se for maior do que a tolerância, tens de escrever o motivo.
4. **Fechar turno**. Confirma o fecho no ecrã. O sistema tenta imprimir o talão e enviar o resumo ao dono;
   papel e email dependem da configuração. Se falharem, avisa o gerente sem lançar outro fecho ou venda.
5. A pessoa seguinte entra com o cartão e o PIN dela, conta o troco e toca em **Abrir turno**.

Antes de fechar: se o POS avisar que há **vendas offline por sincronizar**, espera pela confirmação verde.
Se houver **mesas com conta aberta**, cobra-as primeiro — o que não for pago não entra no fecho.

### Fecho do dia (no fim de tudo)

1. Fecha o último turno, como acima.
2. Na aba **Caixa** aparece **Fim do dia?** → **Fecho do dia**.
3. O ecrã mostra o dia inteiro: cada turno (quem abriu, quem fechou, a diferença), as vendas por forma de
   pagamento e a **diferença do dia**. Confere e toca em **Confirmar fecho do dia**.
4. Confirma que o dia ficou fechado; confere o talão e, com o gerente, o envio do email quando configurado.

Com um turno aberto, o fecho do dia não deixa — fecha primeiro o turno.

M-Pesa, e-Mola e cartão aparecem **separados** — esse dinheiro não está na gaveta.

---

## 6. Chamar ajuda

| Situação | Quem |
|---|---|
| POS não abre, não entra, ecrã preto | Gerente → Niraslab |
| Impressora não imprime | Gerente (ver papel e cabo) → Niraslab |
| Pedido não aparece na cozinha | Gerente: reimprimir comanda pelo painel |
| Diferença grande na caixa | Gerente, **antes** de fechar |

O balcão também pode aprovar pedidos online depois de conferir o comprovativo e marcar um produto
esgotado/disponível. Se tiveres dúvida sobre uma entrada de dinheiro, não aproves apenas pela imagem:
confirma com o responsável. Mesas pagam pela conta da mesa, não por uma nova venda duplicada.

Guias do responsável: [POS](../modulos/pos.md), [Caixa](../modulos/caixa.md), [Mesas](../modulos/mesas.md)
e [contingência do equipamento](hardware.md).
