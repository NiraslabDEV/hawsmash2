# HAWSMASH 2.0 — Restaurant OS multi-unidade

Aplicação de restaurante com POS, encomendas online, mesas, pagamentos, caixa, estoque, impressão e TVs. Uma instalação representa uma empresa; cada unidade física tem o seu `store_id`. A identidade é dado em `brand_settings`, com fábrica neutra no código.

Começa pelo [índice da documentação](docs/README.md). As decisões estão no [CLAUDE](CLAUDE.md), o método em [AGENTS](AGENTS.md), a execução no [ROADMAP](ROADMAP.md), as dependências em [BLOQUEIOS](BLOQUEIOS.md) e a evolução no [roadmap de produto](ROADMAP-PRODUTO.md).

## Arranque de desenvolvimento

Pré-requisitos: Git, Node **22.x** (aceita >=22 e <25), pnpm **9.0.0**. Para BD local descartável: Docker e Supabase CLI disponíveis no PATH. Sem BD podes correr testes unitários e simular impressão; isso não entrega checkout funcional.

Na raiz, em PowerShell:

```powershell
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example apps/web/.env.local
```

Preenche localmente o exemplo copiado com URL/chaves da BD de desenvolvimento, nunca produção. Next lê a configuração de `apps/web`; CLIs e bridge têm configuração própria. Ver [ambiente](docs/referencia/ambiente.md).

Para criar uma BD **local descartável**, com Docker a correr:

```powershell
supabase start
pnpm db:migrate
pnpm --filter web dev
```

**db:migrate e db:seed executam supabase db reset:** apagam e recriam a BD local. Não são actualização incremental de uma instalação. O seed é específico da primeira instalação, não onboarding neutro.

Abre `http://localhost:3000`. `/` escolhe loja; `/login` autentica staff; `/pedidos` é o painel; `/pos` é o balcão. Não existe prefixo `/admin`. Conta de ensaio, perfil e loja: [instalação](docs/operacao/instalacao.md).

`pnpm dev` arranca as tarefas do monorepo, incluindo serviços que exigem configuração; o comando acima arranca apenas a web.

## Impressão sem equipamento

```powershell
pnpm --filter print-bridge dev:sim
```

Inicia impressora TCP em loopback, envia talão sintético e termina. Não usa Supabase nem equipamento. Para o serviço integrado, ver [impressão](docs/modulos/impressao.md) e [bridge](services/print-bridge/README.md). O atalho raiz bridge:dev usa sintaxe POSIX e não funciona tal qual no shell Windows padrão.

## Verificar

```powershell
pnpm lint
pnpm test
node scripts/docs/check-links.mjs
node scripts/docs/check-schema.mjs
node scripts/docs/check-spec.mjs
node scripts/docs/schema-catalog.mjs --check
```

Lint inclui TypeScript. O teste raiz corre __tests__, **não o gate de BD**. Com Supabase local descartável, sem hardware ligado, o gate separado é `pnpm --filter @delivery/db test:db --run`. Escreve/remove fixtures e utilizadores: nunca apontar a uma instalação em uso.

`pnpm test:e2e` corre Playwright padrão. Agentes, paginação, análise e pagamentos têm configs próprias: [matriz de testes/CI](docs/referencia/testes.md).

Next/Vite carregam ficheiros de ambiente. Para auditorias que proíbem essa leitura, o [validador isolado](scripts/docs/validate-isolated.mjs) copia apenas ficheiros permitidos, sem configuração privada.

## Operação e limites

Fluxo previsto: dev → staging → main → produção, com bases separadas e migrations primeiro em staging. [Runbook](docs/operacao/runbook.md) e [bloqueios](BLOQUEIOS.md) distinguem código de instalação validada.

A [auditoria](docs/AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec) contém violações de permissões, isolamento e idempotência ainda não corrigidas nesta revisão documental. Documentação e testes unitários não as resolvem nem garantem operação em produção.
