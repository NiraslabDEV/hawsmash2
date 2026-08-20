# Manual do dono — HAWSMASH 2.0

> Duas lojas, um só painel. Este manual diz onde está cada coisa e o que decidir em cada caso.

---

## 1. O que vês, e onde

| Aba | Serve para |
|---|---|
| **Pedidos** | Tudo o que entrou, das duas lojas. Filtro por loja no topo. Aprovar, recusar, avançar, reimprimir |
| **Caixa** | Abertura, sangria/reforço, fecho com contagem, por loja e consolidado |
| **Estoque** | Entrada, quebra, contagem e histórico de movimentos, por loja |
| **Cardápio** | Produtos, preços e fotos (catálogo partilhado pelas duas lojas) |
| **Lojas** | Morada, contactos, números de pagamento, rodapé do talão, horário, zonas e o **fecho da loja** |
| **Equipa** | Contas, perfis, lojas e PIN — só tu mexes aqui |
| **Sistema** | Semáforo de cada loja: POS, impressão, último pedido, fila, caixa, estoque |
| **Análise** | Vendas, produtos, horas de pico |

O painel só te mostra dinheiro e dados das lojas a que tens acesso. Como dono, vês as duas.

---

## 2. Equipa — quem pode o quê

| Perfil | Vê | Pode |
|---|---|---|
| **Dono** | as duas lojas | tudo, incluindo preços, equipa e anulações |
| **Gerente** | a sua loja | aprovar, anular, caixa, estoque, cardápio da loja |
| **Caixa** | a sua loja | vender no POS, imprimir, fechar a sua caixa |
| **Cozinha** | a sua loja | ver pedidos e avançar o preparo. **Não vê dinheiro** |

**Criar conta:** Equipa → *Nova conta* → nome, email, palavra-passe, perfil, loja(s) e (opcional) PIN.
**Tirar acesso:** Equipa → *Remover acesso* → escreve o motivo. **O acesso cai no momento**, e fica registado quem removeu, quando e porquê.

---

## 3. Dinheiro

- **Preço vive na base de dados**, nunca no telemóvel de ninguém. Alterar preço é na aba Cardápio (ou por loja, na aba Estoque, quando o preço difere).
- **Fecho de caixa** conta desde o **último fecho** — não desde a meia-noite. Diferença acima da tolerância exige motivo escrito.
- **M-Pesa, e-Mola e cartão** aparecem sempre separados do dinheiro da gaveta.
- **Venda anulada nunca desaparece**: fica no histórico com motivo e autor.

---

## 4. Quando algo corre mal

O sistema avisa-te **antes** de alguém te ligar. Recebes email quando:

- um POS ou a impressão de uma loja fica **sem sinal mais de 5 minutos**;
- há **trabalhos de impressão falhados**;
- um pedido pago fica **mais de 2 minutos sem comanda**;
- um produto **esgota** ou passa abaixo do mínimo;
- uma loja fica **90 minutos sem vendas** em horário de funcionamento.

Cada email traz um botão para **falar com a loja no WhatsApp**. A aba **Sistema** mostra o mesmo ao vivo.

**Fechar uma loja temporariamente** (falta de luz, obras): aba **Lojas** → escolher a loja → escrever o
motivo → *Fechar loja agora*. O site deixa de aceitar encomendas **dessa loja** e a outra continua a vender.
O gerente da loja também o pode fazer; fica registado quem fechou, quando e porquê.

---

## 5. Todos os dias

Recebes, ao fim do dia, o **resumo por loja**: pedidos, facturado, decomposição por forma de pagamento,
fecho de caixa com diferença e número de incidentes.

---

## 6. O que o sistema **não** faz

- **Não emite factura fiscal certificada (AT)** — não estava no âmbito.
- **Não fala com o terminal de cartão** — regista que foi cartão; o terminal é do banco.
- Fora do horário da loja, o cliente pode **agendar**, não pedir para já.

---

## 7. Contacto

Niraslab · Gabriel dos Santos — niraslab.dev@gmail.com
Suporte 7 dias em horário de loja, prioridade a qualquer falha que impeça vender.
