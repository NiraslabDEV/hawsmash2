# Formato canónico de cardápio (`menu.json`)

> O **padrão aceite** pelo importador de produtos. Quando se pede "organiza os produtos do site X",
> o resultado deve respeitar este formato. `pnpm menu:import` valida o ficheiro e, sem `--dry-run`, escreve na BD configurada.
>
> **Agnóstico de design:** os produtos vivem na base de dados; qualquer front (qualquer designer)
> lê-os via `get_menu()`. Trocar o design do site **não** muda este formato.

**Estado:** leitura do código local em 26/09/2026; nenhum import foi executado nesta revisão.
Fontes: [script](../../scripts/import-menu.ts), [schema e normalizador](../../packages/core/src/menu-import.ts)
e [money.ts](../../packages/core/src/money.ts). Este formato trata categorias/produtos; não é um importador
de vendas, variantes, adicionais, modificadores ou de todos os preços/configurações por loja.

## Estrutura

```jsonc
{
  "version": 1,            // opcional
  "currency": "MZN",       // opcional (informativo)
  "categories": [
    {
      "name": "Entradas",          // obrigatório, único por cardápio
      "sort": 1,                    // opcional (ordem; default 0)
      "station": "kitchen",        // opcional: kitchen | bar | cold_kitchen (default kitchen)
      "active": true,              // opcional (default true)
      "items": [
        {
          "name": "Caril de Camarão",   // obrigatório
          "description": "Molho de coco", // opcional
          "price": "130.00",              // opcional, MT decimal; null/omitido = a confirmar
          "photo_url": "https://...jpg",  // opcional (URL da foto)
          "available": true,              // opcional (default true)
          "track_stock": false,           // opcional (default false)
          "stock_qty": 0,                 // opcional (default 0)
          "sort": 0                       // opcional
        }
      ]
    }
  ]
}
```

## Regras

- **Preço em MT decimal** (`130`, `130.00` ou `"25.50"`), convertido para centavos inteiros por
  `normalizeMenuImport` e `packages/core/src/money.ts`. Não pôr centavos no campo `price`.
- **Preço nulo ou omitido:** o normalizador grava `price_cents=0`, força `available=false` e acrescenta
  `(preço a confirmar)` à descrição. Um zero explícito é diferente: mantém o `available` fornecido/default.
- **Conversão de preço:** números passam por `toFixed(2)`; texto é convertido por `decimalStringToCents`
  com aritmética de inteiros (sem float, desde 26/09 — [auditoria V-07](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec)).
  Aceita ponto ou vírgula; a partir da terceira casa arredonda meio para cima; recusa negativos, notação
  científica e texto a seguir ao número (`12abc`). A aba Cardápio do painel ainda tem uma conversão local
  própria, por alinhar.
- `name` da categoria e do item identificam os registos na importação. O normalizador remove espaços
  exteriores, mas não verifica unicidade de nomes no ficheiro; conferir duplicações antes de importar.
- `photo_url` deve ser uma URL acessível ou caminho público correcto: a loja usa-o tal como recebido.
  O schema apenas valida que é uma string. Sem foto, deixar `""` ou omitir.
- Campos extra (ex.: lixo do scraping de um site) são **ignorados** — só estes campos são lidos.
- `version` e `currency` são opcionais/informativos; não seleccionam outro formato nem fazem câmbio.
- O exemplo está em JSONC para explicar campos; o ficheiro de entrada tem de ser JSON sem comentários.

## Como importar

Executar a partir da raiz. Primeiro preparar/conferir o ficheiro e usar o modo de leitura:

```powershell
# Pré-visualizar (não escreve nada):
pnpm menu:import examples/menu.example.json --dry-run
```

O dry-run termina antes de ler `.env` ou chamar a rede. Imprime categorias, produtos e preços normalizados;
a apresentação do próprio script usa divisão por 100 e `toFixed(2)`, não `formatMT`.

Só no ambiente de importação autorizado, depois de confirmar o destino:

```powershell
pnpm menu:import caminho/para/menu.json
```

O script lê o `.env` do directório de trabalho, usando `NEXT_PUBLIC_SUPABASE_URL` (ou `SUPABASE_URL`) e
`SUPABASE_SERVICE_ROLE_KEY`, e faz POST à RPC `import_menu(p_payload jsonb)`. O acesso actual é
**service_role**, não `authenticated`; ver [catálogo de RPCs](../referencia/rpcs.md). Uma futura interface
de importação precisa de autorização no servidor e pré-visualização próprias — não deve expor essa chave.

O script não selecciona loja nem tem um argumento de confirmação específico para produção. Não executar
um import com base apenas no nome do ficheiro ou numa promessa de idempotência. O contrato de abertura,
ambientes e alterações da instalação está no [runbook](../operacao/runbook.md).

Exemplo completo: [menu.example.json](../../examples/menu.example.json). Testes do normalizador:
[menu-import.test.ts](../../packages/core/src/__tests__/menu-import.test.ts); não foram corridos nesta revisão.
