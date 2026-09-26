# Instalação e entrega de uma unidade/cliente

Checklist para o responsável técnico preparar uma instalação, validar em staging e entregar a operação.
Absorve a antiga checklist de onboarding e corrige os pressupostos herdados de marca em ficheiro,
configuração global de loja, Resend e bridge apenas TCP. Uma instância serve uma empresa; cada empresa
tem deploy e BD próprios, com unidades físicas identificadas por `store_id`.

**Cliente:** __________________ **Loja(s):** __________________ **Data:** __________

**Responsável técnico:** __________________ **Ambiente alvo:** __________________

O objectivo histórico de preparar um cliente em menos de 30 minutos só serve como meta de um ensaio
com infra/configuração já prontas. Não inclui compra de hardware, contas de fornecedor, migração de dados,
DNS, formação nem autorização para dinheiro real. Não foi instalado ou publicado nada nesta redocumentação.

## 1. Código, ambientes e marca

- [ ] Registar versão/commit e usar `dev` para trabalho e validação; não trabalhar directamente em `main`.
- [ ] Preparar staging e produção separados, cada um com o seu Supabase e configuração de deploy.
- [ ] Confirmar Node compatível com `package.json` (`>=22 <25`) e pnpm indicado (`9.0.0`); instalar dependências pelo lockfile.
- [ ] Configurar os nomes de variáveis a partir de [Ambiente](../referencia/ambiente.md) e do [exemplo raiz](../../.env.example),
  nos processos que as usam. Não guardar credenciais na documentação ou no repositório.
- [ ] Confirmar URLs/chaves da instância correcta em cada processo; copiar `.env` para a raiz, por si só,
  não demonstra que o serviço Next em `apps/web` ou o bridge receberam essa configuração.
- [ ] Preencher nome, cores, logo, textos e contactos em **Aparência**, na BD (`brand_settings`).
  **Não copiar/editar `config/brand.ts` com a identidade do cliente:** é o fallback neutro de fábrica.
- [ ] Carregar os assets pelos mecanismos do painel/Storage apropriados e verificar os caminhos públicos/assinados conforme o bucket.

Fontes: [Aparência](../modulos/aparencia.md), [ADR 0001](../decisions/0001-multi-unidade.md) e [migrations](../referencia/migrations.md).

## 2. Supabase e dados iniciais

- [ ] Conferir projecto, credenciais e destino **antes** de qualquer operação de schema ou importação.
- [ ] Aplicar a cadeia versionada primeiro em staging pelo processo de mudança aprovado; validar grants, RLS,
  funções, Storage e dados antes de promover. Não correr SQL manual em produção.
- [ ] Distinguir comandos: `pnpm db:migrate` e `pnpm db:seed` executam **`supabase db reset`**;
  `pnpm setup:client` também valida e depois executa reset. Não são instaladores incrementais de produção.
- [ ] Usar resets apenas numa BD local descartável cuja identidade foi conferida. `setup:check` valida
  configuração, mas lê o `.env` e não prova migrations aplicadas nem readiness operacional.
- [ ] Rever os seeds por instalação: dados históricos/exemplos não são o catálogo, horários, carteiras ou equipa reais do cliente novo.
- [ ] Confirmar bucket privado `payment-proofs` e acesso por URL assinada; conferir também buckets de imagens/vídeos utilizados.
- [ ] Executar os gates de BD/RLS no ambiente de ensaio autorizado. `pnpm test` na raiz não inclui os testes de `packages/db/tests`.
- [ ] Registar contagens e conferir qualquer importação antes/depois, sem usar um importador legado como ferramenta genérica de actualização.

Os scripts de limpeza, equipa e importação têm efeitos próprios; consultar [referência de testes](../referencia/testes.md)
e [auditoria](../AUDITORIA-DOCUMENTACAO.md). O importador 1.0 promete um guard de produção que não implementa;
não tomar o comentário como protecção. Limpar demonstração não é uma etapa automática numa base com vendas.

## 3. Dono, lojas e catálogo

- [ ] Criar o primeiro dono e validar a sessão administrativa sem expor a service key ao navegador.
- [ ] Em **Lojas**, preencher nome/morada/contactos, prefixo, canais, horários, zonas/taxas e carteira/fornecedor de cada unidade.
- [ ] Usar `stores.accepting_orders` para abrir/fechar a unidade; o antigo singleton de `settings` não substitui esta escolha.
- [ ] Conferir cardápio real: categorias, produtos, variantes, adicionais, fotos, preço e disponibilidade por loja.
- [ ] Contar produto final e ingredientes antes de ligar controlo; preencher fichas/custos com dados reais.
- [ ] Conferir rodapé, número de vias/modelos e conteúdo do POS em **POS** (`/definicoes-pos`).
- [ ] Criar equipa, perfis e lojas atribuídas; configurar PINs individualmente e ensaiar cartões + PIN.
- [ ] Para mesas/TVs, confirmar a quantidade real, QR/URL da unidade e equipamento; não copiar números de mesas da instalação anterior.

Ver [Lojas](../modulos/lojas.md), [Estoque](../modulos/estoque.md), [Equipa](../modulos/equipa.md),
[POS](../modulos/pos.md), [Mesas](../modulos/mesas.md) e [TVs/KDS](../modulos/tvs-kds.md).
KDS dedicado permanece planeado; a política pretendida para cozinha tem divergências de RLS identificadas.
Não entregar credenciais financeiras como substituto de um ecrã de cozinha.

## 4. Pagamentos

- [ ] Confirmar com o dono a conta de destino de **cada loja e método**. Não inferir que duas lojas partilham carteira.
- [ ] Escolher o modo manual quando os contratos digitais ainda não estiverem prontos e conferir o procedimento de comprovativo.
- [ ] Se Paysuite: configurar chave e segredo no âmbito correcto, retorno/callback e assinatura; não colar chaves em documentação.
- [ ] Se M-Pesa directo: obter todas as credenciais e endereços do ambiente do fornecedor, configurar por loja e ensaiar o resultado incerto.
- [ ] e-Mola directo: manter a guarda enquanto não existir adaptador real e contrato Movitel; o simulador não activa cobrança real.
- [ ] Configurar verificação/reconciliação agendada, `CRON_SECRET`, cursores, limites e destinatários de incidentes.
- [ ] Ensaiar retry, pagamento pendente, confirmação tardia e mesma chave antes de qualquer activação financeira.
- [ ] Fazer cobrança real apenas num ensaio expressamente autorizado pelo responsável, com montante e conta definidos.

[Pagamentos](../modulos/pagamentos.md) distingue manual, presença no balcão, redirect, directo e simuladores.
B-001/B-100/B-106/B-108/B-109 em [BLOQUEIOS](../../BLOQUEIOS.md) mantêm o estado dos acessos/ensaios necessários.

## 5. Email, alertas e backups

- [ ] Configurar **SMTP**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`; destinatário `OWNER_EMAIL`
  e destinatários por loja quando utilizados. O contrato actual é o [ADR 0004](../decisions/0004-email-smtp-hostinger.md), não Resend.
- [ ] Testar entrega real de pedido, aprovação/recusa e fecho; conferir a caixa do destinatário e os erros de transporte.
- [ ] Provisionar agendador para cada endpoint necessário de [Crons](../referencia/crons.md). A existência da rota ou de `railway.json`
  não cria um scheduler; confirmar Bearer e periodicidade por instalação.
- [ ] Ensaiar alertas e confirmar `payload.delivery=sent`; `alert.sent` também pode representar envio falhado/omitido.
- [ ] Configurar a consulta Google/Place IDs se o resumo mensal os utilizar; declarar ausência dessa parte quando não configurada.
- [ ] Configurar backup local, cópia externa e retenção; `BACKUP_TARGET` preenchido não implementa upload no script actual.
- [ ] Realizar um restauro em BD temporária e registar tempo/resultado no [runbook](runbook.md).
- [ ] Confirmar plano/backups/PITR contratados efectivamente; não presumir PITR só pelo nome do ambiente.

## 6. Deploy e validação

- [ ] Confirmar que Railway está ligado ao repositório/branch previstos. `railway.json` define build, arranque e healthcheck,
  mas não comprova que a integração remota esteja activa.
- [ ] Configurar domínio e `APP_BASE_URL`/`NEXT_PUBLIC_APP_BASE_URL` coerentes; validar HTTPS, cookies e origens permitidas.
- [ ] Passar lint/tipos, testes puros, gate de BD, build e E2E apropriados no ambiente autorizado; registar commit e resultados.
- [ ] Validar staging com as duas lojas, perfis, pedido manual/digital simulado, balcão, caixa e isolamento.
- [ ] Rever a [auditoria](../AUDITORIA-DOCUMENTACAO.md) e os bloqueios materiais antes da promoção; documentação não corrige falhas de runtime.
- [ ] Promover só depois dos critérios de staging, numa janela fora do horário, com plano de rollback de aplicação compatível com o schema.
- [ ] Confirmar healthcheck e percurso público após publicar; um HTTP 200 isolado não substitui encomenda/caixa ponta a ponta.

## 7. Terminal, impressão e contingência

- [ ] Instalar/vincular PWA e preparar arranque kiosk; confirmar loja, cartão/PIN e bloqueio.
- [ ] Instalar o bridge no PC local, com o [exemplo específico](../../services/print-bridge/.env.example): Supabase,
  `STORE_ID`, `BRIDGE_DEVICE_ID`, `LOCAL_TOKEN`, `LOCAL_ALLOWED_ORIGINS` e destinos de impressora.
- [ ] Escolher TCP, fila Windows USB ou porta série conforme equipamento. Instalar driver/fila e testar a conta que executa a tarefa.
- [ ] Proteger a chave `service_role`: é uma chave administrativa que contorna RLS, não uma credencial restrita à loja.
- [ ] Verificar vias, acentos, preços conforme modelo, QR, corte, senha, gaveta e visor; heartbeat verde não prova papel.
- [ ] Ensaiar falha de internet mantendo LAN, falha da impressora, reinício e recuperação da fila. Não limpar IndexedDB.
- [ ] Confirmar UPS, ligação de reserva e cópia cifrada de recuperação; cronometrar substituição de PC.

Para estas lojas, impressão/cozinha/gaveta fazem parte dos requisitos da abertura; não são uma opção
dispensável como dizia a checklist antiga. Usar [Hardware](hardware.md), [Impressão](../modulos/impressao.md)
e os dez testes de aceitação. `dev:sim` é demo local; `dev` do bridge inicia serviço completo com BD configurada.

## 8. Entrega e assinatura

- [ ] Entregar acessos por canal seguro, individualmente; não anexar senhas/tokens a este documento.
- [ ] Formar dono, caixa e cozinha com os respectivos [manuais](manual-dono.md); incluir mesas, troco, fila offline e falhas do papel.
- [ ] Partilhar URL/QR público da instalação e os contactos de suporte pelo canal acordado, sem copiar contactos privados para o repositório.
- [ ] Afixar a folha de contingência e conferir quem pode abrir a gaveta com chave física.
- [ ] Executar e registar o ensaio geral por loja, incluindo fecho do turno e do dia, e assinar a checklist do [runbook](runbook.md).
- [ ] Entregar lista de pendências por responsável, mantendo explícito o que ficou por validar.

**Resultado:** ☐ validado para entrega ☐ condicionado às pendências anexas ☐ não aprovado

**Responsável técnico:** __________________ **Responsável da loja:** __________________

**Pendências e evidência:** __________________________________________________________
