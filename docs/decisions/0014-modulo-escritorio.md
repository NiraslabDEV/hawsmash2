# ADR 0014 — Escritório: a papelada do restaurante dentro do motor

- Estado: aceite para o **motor** (pedido do Gabriel a 19/11/2026); **ligar num cliente continua por decidir** (B-019)
- Data: 2026-11-19
- Decisores: Gabriel (Niraslab)
- Complementa: [ADR 0013](0013-facturacao-fiscal-no-motor.md) · Módulo: [docs/modulos/escritorio.md](../modulos/escritorio.md)

## Contexto

A facturação (ADR 0013) resolvia só o documento. O dono de um restaurante em Moçambique tem mais papelada à volta:
o ficheiro do mês para o e-Declaração, o IVA (o das vendas e o das compras), os prazos do contabilista, licenças e
alvarás com validade, os dados do pessoal para salários e INSS. Hoje isso vive em papel, em WhatsApp e na cabeça
do contabilista. É também o argumento de venda do WinTable contra os sistemas antigos de PC: o contabilista
recebe tudo sem pedir.

## Decisão

1. **Um separador "Escritório" no painel**, do dono e do gerente: resumo do mês, facturas, compras, obrigações,
   arquivo; pessoal, acesso do contabilista e definições fiscais só do dono. A BD impõe o mesmo (1141).
2. **O NUIT pede-se antes de pagar e viaja pela chave da venda** (`client_sale_id`, `client_close_id`, ou o id do
   pedido no site), numa fila (`fiscal_buyer_requests`) que a emissão lê. Alternativa recusada: acrescentar o NUIT ao
   payload de cada RPC de venda — sete funções grandes reescritas no LIVE para um campo opcional.
3. **Talão fiscal próprio na fila de impressão** (`kind = 'fiscal'`), com a versão do formato no payload. Uma bridge
   antiga não tem o formato e falha o trabalho: antes nenhum papel do que uma factura incompleta.
4. **Contabilista por ligação com token opaco** (como o garçom e o estafeta), só leitura, revogável, com prazo, e o
   token depois do `#` no endereço. Alternativa recusada: um perfil `accountant` em `staff_profiles` — muitas
   políticas de RLS só olham para a loja e abririam escrita a um perfil novo.
5. **Compras são registos internos, editáveis com rasto** (não são documentos fiscais nossos); anular exige motivo.
6. **Prazos são dados, não código.** Só o modelo da e-Declaração traz prazo (último dia útil do mês seguinte, com
   fonte); os outros (IVA, INSS, IRPS) vêm sem dia, para o dono preencher com o contabilista.
7. **Avisos por email, um por assunto e por dia**, pelo cron do Escritório, que também emite as facturas pendentes.

## Consequências

- Continua fora do contrato `NL-2026-HS-EXP`. Nada liga sozinho: sem `fiscal_settings.active` o POS e o site não
  mostram o NUIT e nenhuma venda muda. O resto do Escritório (compras, arquivo, obrigações, pessoal) funciona sem a
  facturação ligada.
- A bridge das lojas tem de ser actualizada antes de ligar a facturação, para o talão fiscal sair.
- O ficheiro do mês continua com colunas provisórias até a AT enviar o modelo.
- A "estimativa de IVA a pagar" é uma ajuda: quem fecha as contas é o contabilista.
