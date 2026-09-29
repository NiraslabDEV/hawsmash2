# Decisões de arquitectura

Decisões aceites não se reescrevem para acomodar divergências de implementação. Ver [spec](../../CLAUDE.md) e [violações identificadas](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec).

| ADR | Decisão | Estado |
|---|---|---|
| [0001](0001-multi-unidade.md) | store_id é unidade física, não cliente comercial | Aceite |
| [0002](0002-criar-loja-a-partir-de-outra.md) | Copiar operação de uma loja, nunca segredos | Aceite; implementação adiada |
| [0003](0003-conta-do-cliente-por-dispositivo.md) | Conta por dispositivo, não telefone sozinho | Aceite; pressuposto de posse violado, V-01 |
| [0004](0004-email-smtp-hostinger.md) | SMTP comum, substituindo Resend | Aceite |
| [0005](0005-canal-publico-de-agentes.md) | MCP/WebMCP prepara revisão, não cobra | Aceite; activação externa pendente |
| [0006](0006-definicoes-do-pos-por-loja.md) | Definições POS como dados por loja | Aceite; cadência divergente, V-11 |
| [0007](0007-modelos-do-talao.md) | Modelos prontos e layout como dado | Aceite; hardware depende da versão instalada |
| [0008](0008-staging-passa-a-live.md) | A base onde a loja já vende passa a ser o LIVE | Aceite; transição em curso |

[Candidatas a novas decisões](../AUDITORIA-DOCUMENTACAO.md#114-decisões-fortes-candidatas-a-adr) permanecem propostas. Nenhum ADR novo foi inventado.
