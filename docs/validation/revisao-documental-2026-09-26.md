# Validação da revisão documental — 26/09/2026

Âmbito: Fases 3 e 4 aprovadas depois do relatório de auditoria. Branch **docs/revisao-geral**, criada de `dev` em `a30c95987703ad1435233904438d67007e1c9f98`. O objecto é a árvore local, incluindo trabalho anterior não commitado. Não se presume publicação.

## Organização e preservação

- CLAUDE: 800 → 238 linhas; contexto, quatro regras, topologia, stack, invariantes e proibições mantidos. Módulos resumidos com ligação para os contratos completos.
- 16 módulos, oito referências técnicas, guias de operação/desenvolvimento, planos e história separados. Endereços antigos de módulos ficam como apontadores de compatibilidade, sem segundo contrato.
- 111 blocos retirados da spec têm SHA-256 e destino no [manifesto](../../scripts/docs/spec-preservation.json). `check-spec.mjs` procura cada bloco no destino, normalizando apenas espaços, destinos de ligações e caminhos de documentos movidos. Não basta contar parágrafos: cada conteúdo é comparado.
- §§0, 1 e 17 e sete ADRs têm hashes independentes. As decisões não mudaram; actualizar destinos de links não altera o texto normativo. A única redacção de conteúdo é a remoção de dois contactos privados da tabela inicial; a decisão de contas partilhadas permanece.
- O SQL ilustrativo e as formulações anteriores transferidos da spec estão identificados como contrato/desenho inicial. O texto actual explica divergências como sync offline, refresh do POS, providers, mesas e KDS. Não se alterou uma regra para justificar o código.
- Os dois corpos locais da montra foram preservados no [arquivo](../historico/montra-plano-anterior.md). Engine/legacy só receberam dois cabeçalhos curtos; os corpos ficaram intactos.
- BLOQUEIOS conserva 37 IDs: 35 abertos, 2 resolvidos, com pacotes antigos no arquivo e novo pacote final. ROADMAP conserva história e distingue validação SQL, humana e física.

## Verificadores

Comandos, a partir da raiz:

```sh
node scripts/docs/check-links.mjs
node scripts/docs/check-schema.mjs
node scripts/docs/check-spec.mjs
node scripts/docs/schema-catalog.mjs --check
node scripts/docs/validate-isolated.mjs
```

O catálogo reconstrói estaticamente **149 migrations, 52 tabelas, 203 assinaturas de função, 16 triggers, 2 views, 5 buckets e 94 locais produtores de eventos**. Os quatro catálogos gerados são comparados byte a byte pelo modo `--check`. Só lê fontes; não executa SQL.

O verificador de nomes examina código inline, tabelas de referência, contexto SQL, `.rpc`/`.from` e blocos SQL. Tem [excepções exactas](../../scripts/docs/schema-exceptions.json) para objectos planeados, alternativas recusadas, nomes históricos e schemas de plataforma. Não prova argumentos, colunas, privilégios efectivos, comportamento ou prosa arbitrária. Fixtures confirmaram que rejeita RPC/tabela inexistentes e que renomear/mover/recriar uma função conserva ACL explícita até à revogação.

O verificador de links inclui âncoras e números de linha, caminhos completos/relativos à aplicação, basenames existentes e padrões com correspondência real. Ignora backticks nos arquivos engine/legacy. As [excepções delimitadas](../../scripts/docs/link-exceptions.json) identificam nomes antigos, exemplos de instalação, artefactos não versionados e caminhos expressamente proibidos à leitura.

**Limite deliberado do arquivo:** quatro destinos de links, em seis ocorrências, continuam escritos como no repositório antigo. Reescrever esses corpos infringiria a restrição de preservação; os dois cabeçalhos dão ligações actuais válidas. São excepções visíveis do verificador, não links declarados válidos. A documentação actual não tem links partidos.

## Lint e testes

Primeira execução numa cópia isolada: instalação `--offline --frozen-lockfile --ignore-scripts`, `lint` e `test` com exit 0. **120 ficheiros / 1116 testes aprovados.** O wrapper detectou apenas uma edição concorrente de Markdown; o critério de hashes foi ajustado para proteger código/migrations e a execução final consta abaixo.

**Execução final: aprovada.** Wrapper, instalação offline, `pnpm lint` e `pnpm test` terminaram com exit 0. Lint incluiu seis tarefas Turbo e os typechecks; a suite voltou a aprovar **120 ficheiros e 1116 testes**. A cópia continha 918 ficheiros permitidos. Os **773 hashes protegidos, incluindo 149 migrations, ficaram intactos**. O [resultado estruturado](../../scripts/docs/validation-result.json) regista tempos, comandos e digests; os logs completos ficaram no temporário da execução.

As fixtures dos verificadores rejeitaram uma âncora inexistente, um caminho inexistente e uma alteração de decisão; aceitaram caminho com parênteses/âncora Unicode e excluíram ficheiros privados antes da leitura. A comparação independente com o início da revisão confirmou 811 ficheiros não Markdown intactos e exactamente oito mudanças de caminho em comentários, sem outra alteração.

O [validador isolado](../../scripts/docs/validate-isolated.mjs) copia apenas ficheiros permitidos, exclui configuração real/credenciais antes de os ler, instala da cache, usa ambiente de subprocessos por lista permitida e limita sockets Node a loopback. Não segue links para fora da cópia. Logs e manifesto ficam no temporário. A guarda de sockets não é uma sandbox do sistema operativo.

Não foram executados SQL, testes de BD, E2E, build, deploy, email real, pagamento ou ensaio físico. `pnpm test` na raiz exclui as suites de BD; B-101/B-102 e os riscos da auditoria continuam abertos. Não se abriu uma instalação real nem ficheiros privados.

## Escopo do diff

O checkout já tinha alterações de runtime, exemplos de ambiente, testes, snapshots e três migrations por commit. Foram preservadas e ficam fora dos commits documentais. Por isso `git diff --stat dev` da árvore completa também mostra esse trabalho anterior; não é legítimo revertê-lo para produzir um diff artificialmente limpo.

Os commits desta revisão só incluem Markdown, novos scripts/metadados em `scripts/docs/` e oito substituições de caminho em comentários. Nos dois ficheiros de código que já estavam modificados, só o comentário é colocado no índice. As migrations não foram editadas.

## Pendências documentadas

As 35 discrepâncias têm correcção de navegação, descrição ou estado nos documentos actuais; D-32 e D-35 também apontam configurações/cobertura que exigem código, sem as corrigir nesta tarefa. As **16 violações** da [auditoria](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec) permanecem para decisão e correcção.

Não ficou um módulo do âmbito sem documento. Configuração efectiva de produção, grants aplicados, capacidade medida, dados/contratos de fornecedores e hardware permanecem por validar porque a tarefa exclui esses acessos/acções. A cobertura documental não é garantia de funcionamento em produção.
