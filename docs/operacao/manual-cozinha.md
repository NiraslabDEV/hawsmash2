# Manual da cozinha — HAWSMASH

> Para quem está na grelha. O pedido registado é a referência; o papel acompanha o trabalho.

---

## 1. A comanda

O sistema prepara a via da cozinha quando o pedido está pago/aprovado, conforme o canal. **Mesas são a
excepção:** o pedido segue para a cozinha antes de a conta ser paga. A saída física depende da impressora/bridge.
Este é um exemplo simplificado; o formato real é o escolhido para a via da loja:

```
        HAWSMASH MAPUTO
            Nº 42
           BALCÃO
------------------------------------
2x Classic Smash
   NOTA: Sem cebola
1x Batata
------------------------------------
        19/08  20:14
```

- **Nº grande** = número do dia daquela loja. É por ele que o balcão chama o cliente.
- **BALCÃO / ENTREGA / LEVANTAMENTO** = para onde vai o pedido.
- **NOTA** = pedido especial do cliente. Ler sempre antes de montar.
- O modelo **Cozinha** não tem preços. Os modelos **Completo** e **Compacto** podem ter preços/pagamento;
  a via do cliente costuma sair nesta impressora para acompanhar o saco. Não assumir que todo o papel
  que sai na cozinha é uma comanda sem valores.
- Papel marcado **REIMPRESSÃO** ou **ALTERAÇÃO** não é automaticamente um pedido novo. Confirmar a senha e
  o que mudou com o balcão antes de preparar outra vez.

---

## 2. Fluxo de trabalho

1. Comanda sai → montar.
2. Quando estiver pronto, avisar o balcão para o marcar como **Pronto** e fazer a chamada.
3. A senha aparece na TV se o ecrã estiver configurado e ligado. Sem TV, o balcão chama a senha verbalmente.

Não existe KDS dedicado implementado nesta versão. Se for disponibilizado um ecrã à cozinha, o responsável
tem de validar o percurso e perfil; não se empresta uma sessão de caixa ou gerente.

---

## 3. Quando o papel não sai

**Nunca esperar em silêncio.** Um pedido pago sem comanda é dinheiro já cobrado sem comida a ser feita.

1. Avisar o balcão: o pedido **está no painel**, mesmo sem papel.
2. O balcão/gerente carrega em **Reimprimir comanda**.
3. Se continuar sem sair:
   - verificar **papel** e a **luz** da impressora;
   - verificar o cabo/destino da impressora: rede ou ligação local ao PC, conforme a instalação;
   - o balcão/gerente transmite a lista por escrito ou acompanha-a no seu ecrã enquanto o suporte resolve.
4. Se os alertas por email estiverem configurados e agendados, podem avisar o suporte de pedidos sem papel.
   **A equipa avisa na mesma**; não fica à espera do email automático.

---

## 4. Esgotados

Quando um produto acaba:

1. Avisar o balcão/gerente **imediatamente**.
2. O caixa pode marcar esgotado/disponível no POS; o gerente trata contagens, quebras e reposição na aba Estoque.
3. Conferir que deixou de poder ser escolhido naquela loja depois da actualização. A outra unidade mantém
   a sua disponibilidade; um terminal sem rede pode ainda ter informação antiga.

Não continuar a montar um produto que já acabou: o cliente paga e não recebe.

## Nota para o responsável pela instalação

O perfil `kitchen` destina-se a preparação, sem acesso financeiro. Desde a 1097 a cozinha só avança
preparo — não aprova nem cancela. As policies/RPCs de pedidos e payloads de impressão ainda expõem
valores (V-03, B-116): ocultar dinheiro no ecrã não corrige RLS. Não declarar esse isolamento validado
nem usar o manual para alargar permissões; ver V-03/V-14 na
[auditoria](../AUDITORIA-DOCUMENTACAO.md), [Equipa](../modulos/equipa.md) e [Impressão](../modulos/impressao.md).
