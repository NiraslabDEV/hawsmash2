# Manual do dono — HAWSMASH 2.0

> Duas lojas, um só painel. Este manual diz onde está cada coisa e o que decidir em cada caso.

---

## 1. O que vês, e onde

| Aba | Serve para |
|---|---|
| **Pedidos** | Tudo o que entrou, das duas lojas. Filtro por loja no topo. Aprovar, recusar, avançar, reimprimir |
| **Caixa** | Abertura, movimentos, fecho de turno com contagem e fecho do dia que agrega turnos fechados, por loja |
| **Estoque** | Entrada, quebra, contagem e histórico de movimentos, por loja |
| **Cardápio** | Produtos, preços e fotos (catálogo partilhado pelas duas lojas) |
| **Lojas** | Morada, contactos, números de pagamento, rodapé do talão, horário, zonas e o **fecho da loja** |
| **POS** | Como o balcão de cada loja vende: que meios de pagamento aparecem, as frases e os produtos do upsell, os atalhos de nota ("SEM CEBOLA"), com que tipo de pedido abre e se toca quando chega um pedido. Chega ao POS sozinho em até 2 minutos. Também a **impressão**: quantas vias por pedido e o modelo de cada uma (Completo, Compacto ou Cozinha, sem preços), com o talão desenhado no ecrã antes de guardar — o mini-PC aplica-o em até 1 minuto. *Copiar para outra loja* poupa fazer tudo duas vezes |
| **Equipa** | Contas, perfis, lojas e PIN — só tu mexes aqui |
| **Sistema** | Semáforo de cada loja: POS, impressão, último pedido, fila, caixa, estoque |
| **Análise** | Vendas, produtos, horas de pico e origens; conferir loja/período do relatório |
| **Mesas** | Configuração de mesas/QR; no POS, lançar pedidos e cobrar a conta aberta |
| **TVs** | Ecrãs, modos e vídeos por loja; a presença desta aba não significa que as TVs físicas estejam ligadas |

Como dono, vês as duas lojas. Escolhe uma unidade concreta antes de alterar a sua operação.
As permissões precisam de validação na instalação; esconder uma aba não garante, sozinho, isolamento de dados.

---

## 2. Equipa — quem pode o quê

| Perfil | Vê | Pode |
|---|---|---|
| **Dono** | as duas lojas | tudo, incluindo preços, equipa e anulações |
| **Gerente** | a sua loja | aprovar, anular, caixa, estoque, cardápio da loja, definições do POS da loja |
| **Caixa** | a sua loja | vender, imprimir, caixa, aprovar comprovativos no POS e marcar produtos esgotados/disponíveis |
| **Cozinha** | preparação da sua loja | regra pretendida: pedidos/preparo sem dinheiro; há divergência de permissões ainda identificada na auditoria |

**Criar conta:** Equipa → *Nova conta* → nome, email, palavra-passe, perfil, loja(s) e (opcional) PIN.
**Tirar acesso:** Equipa → *Remover acesso* → escreve o motivo. A conta fica desactivada e o evento é registado;
confere os dispositivos e sessões em uso com o suporte. Não partilhar uma conta entre operadores.
**Entrada diária no balcão:** cada pessoa toca no cartão com o seu nome e introduz o PIN. Email/palavra-passe
continuam para preparação inicial e acesso ao painel, não como passo obrigatório de cada venda.

Não há KDS dedicado nesta versão. Até validar/corrigir as restrições de `kitchen`, não entregar uma sessão
financeira à cozinha nem afirmar que os valores estão tecnicamente ocultos em todos os caminhos. Detalhes
em [Equipa](../modulos/equipa.md) e na [auditoria](../AUDITORIA-DOCUMENTACAO.md).

---

## 3. Dinheiro

- **Preço definitivo vem da base de dados.** Alterar preços no painel através dos controlos disponíveis;
  o suporte confirma a configuração por loja. Offline o POS mostra a última cache e sincroniza depois.
- **Fecho de caixa** conta desde o **último fecho** — não desde a meia-noite. Diferença acima da tolerância exige motivo escrito.
- **M-Pesa, e-Mola e cartão** aparecem sempre separados do dinheiro da gaveta.
- **Venda anulada nunca desaparece**: fica no histórico com motivo e autor.

---

## 4. Quando algo corre mal

Com agendador, SMTP e destinatários configurados, o sistema pode enviar alertas quando:

- um POS ou a impressão de uma loja fica **sem sinal mais de 5 minutos**;
- há **trabalhos de impressão falhados**;
- um pedido pago fica **mais de 2 minutos sem comanda**;
- um produto **esgota** ou passa abaixo do mínimo;
- uma loja fica **90 minutos sem vendas** em horário de funcionamento.

O email pode trazer um botão para **abrir o WhatsApp da loja**, se o contacto estiver configurado.
Não é envio automático de mensagem pelo WhatsApp. A aba **Sistema** actualiza o estado a cada 30 segundos.
Combina com o suporte um teste de entrega; existir um alerta no registo não prova que o email chegou.

**Fechar uma loja temporariamente** (falta de luz, obras): aba **Lojas** → escolher a loja → escrever o
motivo → *Fechar loja agora*. O site deixa de aceitar encomendas **dessa loja** e a outra continua a vender.
O gerente da loja também o pode fazer; fica registado quem fechou, quando e porquê.

---

## 5. Todos os dias

Quando o agendador e email estiverem activos, recebes o **resumo por loja**: pedidos, facturado,
formas de pagamento, fecho e incidentes. O resumo mensal do dia 1 depende também do agendador;
dados Google exigem configuração própria. Confirma os primeiros envios com o suporte.

O envio actual usa **SMTP**, conforme o [ADR 0004](../decisions/0004-email-smtp-hostinger.md); as referências
antigas a contratar/configurar Resend foram substituídas. Configurar email não activa pagamentos nem substitui
o acompanhamento de um pagamento pendente.

---

## 6. O que o sistema **não** faz

- **Não emite factura fiscal certificada (AT)** — não estava no âmbito.
- **Não fala com o terminal de cartão** — regista que foi cartão; o terminal é do banco.
- O agendamento depende do horário e dos slots aceites para a loja; conferir o percurso antes de prometer
  encomendas fora do período disponível.
- **e-Mola directo ainda está preparado, sem adaptador real Movitel.** Há comprovativo e outras opções
  conforme a loja; não anunciar uma cobrança directa activa só por a opção existir no código.

---

## 7. Contacto

Niraslab · Gabriel dos Santos — niraslab.dev@gmail.com
Suporte 7 dias em horário de loja, prioridade a qualquer falha que impeça vender.

Entregar também [manual do caixa](manual-caixa.md), [manual da cozinha](manual-cozinha.md) e a folha de
[contingência](hardware.md). A conclusão da instalação exige a checklist e os ensaios do [runbook](runbook.md).
