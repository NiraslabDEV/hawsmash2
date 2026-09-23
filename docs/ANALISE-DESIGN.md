# Análise — base visual do painel

Primeira aplicação: `/analise`, vistas Vendas e Aquisição. O resto do painel será migrado numa etapa posterior.

## Reutilizar

- `apps/web/components/admin/insights-ui.tsx`: `MetricCard`, `InsightPanel`, `InsightEmpty` e `InsightIcon`.
- `apps/web/components/admin/insights.css`: tokens e estilos limitados ao contentor `.insights`; importar através dos componentes. Não altera POS, loja pública nem páginas antigas.
- Cabeçalho: contexto curto, título e acção principal. Filtros de loja/período em grupos com `aria-pressed`. Acções com pelo menos 44 px.
- Indicadores: um destaque por grupo, números tabulares, descrição da métrica. Variação só quando existe base real para comparar.
- Conteúdo: gráficos primeiro, detalhes a seguir, exportação no fim. Cartões com 16 px de raio e 24 px de espaço interior, grelhas fluidas e tabelas com deslocamento local por teclado.
- Estados: carregamento mantém filtros; erro explica o que falhou e permite repetir; ausência de dados tem texto explícito. Nunca representar um relatório que falhou como receita zero.

## Acessibilidade e identidade

Texto principal `#faf6ef`, secundário `#c6b9a8`, superfícies `#211b16`/`#2a231d`, realce `#f2c572`. Estes são tokens funcionais do painel, não dados da marca. A linha da vista activa herda `--gold`. Alterar os tokens exige repetir a medição de contraste.

Foco visível, rótulos associados, tabelas com cabeçalhos, controlos nativos, dados dos gráficos também em tabelas e movimento reduzido. Referência: [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Axe sem violações não constitui certificação integral AA nem substitui ensaios com tecnologias de apoio.

## Decisões e dados

- DECISÃO: a base é opt-in para permitir migrar as outras páginas separadamente.
- DECISÃO: uma falha em Aquisição não esconde Vendas; respostas de filtros ultrapassados são ignoradas.
- DECISÃO: lojas da exportação vêm do mesmo acesso resolvido na análise. Um gerente sem loja activa não inicia uma consulta consolidada. A autorização efectiva mantém-se no servidor/RLS.
- Dinheiro mantém centavos inteiros e formatação `formatMT`, incluindo tooltips e tabelas.
- Aquisição usa as janelas móveis de 1/7/30 dias da RPC de vendas. Exportação calcula os limites em Africa/Maputo, independentemente do fuso do computador.
- Não foram alteradas migrations, cálculos de venda, pagamentos ou dados reais.

## Reproduzir a revisão

`pnpm exec playwright test --config playwright.analysis.config.ts`

O servidor e as RPCs são simulados localmente; não são usadas credenciais ou vendas reais. As capturas ficam em `output/playwright/analysis-*.png`. O teste verifica Vendas/Aquisição a 1440, 390 e 320 px, auditoria axe A/AA da área `.insights`, teclado, filtros rápidos, respostas atrasadas, erros/repetição, estados vazios, gerente e exportação CSV.

A sidebar e a barra global existentes ficam fora desta auditoria: pertencem à próxima migração do dashboard. Staging com sessões e dados reais continua pendente em B-111.

## Resultado da corrida de 24 de Setembro

- `pnpm lint`: passou, incluindo TypeScript; avisos existentes noutros módulos.
- `pnpm test`: 103 ficheiros, 942 testes aprovados.
- `pnpm exec playwright test --config playwright.analysis.config.ts`: 8 testes aprovados; zero violações axe A/AA na área analisada; sem erros JavaScript no percurso visual.
- `pnpm --filter web build`: passou com configuração local simulada de Supabase; isto verifica a compilação, não a integração de staging.
- Revisão visual das capturas: gráficos, grelhas, tipografia, foco e funil móvel conferidos; nenhuma rolagem horizontal da página a 320/390 px. As tabelas largas têm deslocamento próprio.
- O teste de exportação do gerente falhou antes da correcção (seleccionava a primeira loja devolvida); passou após reutilizar a lista de acesso da análise. Testes de períodos foram escritos e executados com falha antes da implementação.
