# Loja pública — guia local

Este guia aplica-se a `apps/web/app/(public)/`. A [spec da raiz](../../../../CLAUDE.md), as
[regras de trabalho](../../../../AGENTS.md) e o [ROADMAP da raiz](../../../../ROADMAP.md) orientam
a execução. Não existe uma corrida autónoma das antigas fases The Box.

O [contexto e plano anteriores](../../../../docs/historico/montra-plano-anterior.md) estão preservados
como história. A presente documentação descreve o código local auditado em 26/09/2026, sem afirmar
validação de produção. A montra activa vive em `_storefront/`; a marca vem de `brand_settings`,
com `config/brand.ts` como fallback de fábrica.

## Onde ler o funcionamento

| Assunto | Referência |
|---|---|
| Rotas, carrinho por loja, variantes, checkout, acompanhamento e limites da montra | [Site e checkout](../../../../docs/modulos/site-checkout.md) |
| Marca em runtime, cores, conteúdo, assets e permissões | [Aparência](../../../../docs/modulos/aparencia.md) |
| Dispositivo, recuperação, moradas e identificação | [Conta do cliente](../../../../docs/modulos/conta-cliente.md) |
| Consentimento, funil, purchase, campanhas e upsells | [Marketing](../../../../docs/modulos/marketing.md) |
| MCP/WebMCP, selecção assistida e revisão humana | [Agentes](../../../../docs/modulos/agentes.md) |

## Regras locais que continuam a valer

- Reaproveitar o motor e os contratos existentes; uma alteração visual não deve reescrever carrinho, pagamento ou tracking.
- A marca vive em dados/tokens, não em nomes, cores, imagens ou textos fixos nos componentes.
- Tudo o que é da pele fica debaixo da classe `.hs`; painel e POS têm temas próprios.
- Os resets (`img`, `a`, `button`) escrevem-se em `:where(.hs)`, para valerem 0 de especificidade.
- O carrinho pertence a uma loja. Trocar de loja, inclusive por link ou histórico, deve limpar um carrinho incompatível. Preservar compatibilidade dos dados persistidos; consultar o contrato actual de `useCart`, que já inclui escolhas além do produto simples.
- Os nomes acessíveis são contrato dos testes e2e: `Escolhe a tua loja`, `Ver cardápio de <Loja>`, `Adicionar <Item>`, `Trocar de loja` e o aviso `o teu carrinho é esvaziado`. Alterá-los exige actualizar o contrato deliberadamente.
- Upsell opcional: nunca bloquear a venda nem insistir quando a oferta não se aplica.
- Centavos inteiros e `formatMT`; nunca `Intl currency:'MZN'`. O servidor revalida preço, taxa, desconto, variante, adicionais e horário; o browser apresenta pré-visualização.
- Tracking passa por `apps/web/lib/analytics/track.ts`. O `purchase` do browser só é emitido no acompanhamento quando `paid`/`approved`, nunca ao submeter o checkout.
- Não expor moradas, comprovativos ou dados de pagamento apenas por conhecer o telefone. A conta segue o [ADR 0003](../../../../docs/decisions/0003-conta-do-cliente-por-dispositivo.md); a cadeia vulnerável observada está na auditoria V-01.
- Sem `tenant_id`, planos ou SELECT directo público como atalho às RPCs. Comprovativos privados usam URL assinada.
- Mobile-first, alvos tocáveis ≥40 px, contraste AA, foco visível, `alt` nas imagens e espaço reservado para evitar saltos de layout. Sem links mortos ou ecrãs com dados inventados.

A [auditoria, secção 5](../../../../docs/AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec) regista
divergências entre estas regras e o código. A documentação não as corrige. Testes e ambientes estão na
[referência de testes](../../../../docs/referencia/testes.md); pendências de activação em
[BLOQUEIOS](../../../../BLOQUEIOS.md).
