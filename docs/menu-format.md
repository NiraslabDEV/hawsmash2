# Formato canónico de cardápio (`menu.json`)

> O **padrão aceito** para importar produtos. Quando se pede "organiza os produtos do site X",
> o resultado deve respeitar este formato — depois `pnpm menu:import` carrega-o para a BD em segundos.
>
> **Agnóstico de design:** os produtos vivem na base de dados; qualquer front (qualquer designer)
> lê-os via `get_menu()`. Trocar o design do site **não** muda este formato.

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
          "price": 130.00,                // obrigatório, MT decimal (número ou string)
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

- **Preço em MT decimal** (`130`, `130.00` ou `"25.50"`). É convertido para **centavos inteiros**
  na importação (via `packages/core/money.ts`) — nunca pôr centavos no ficheiro.
- `name` da categoria e do item identificam o registo: re-importar **atualiza** (não duplica).
- `photo_url` deve ser uma URL acessível (a loja mostra-a tal e qual). Sem foto → deixar `""` ou omitir.
- Campos extra (ex.: lixo do scraping de um site) são **ignorados** — só estes campos são lidos.

## Como importar

```bash
# Pré-visualizar (não escreve nada):
pnpm menu:import examples/menu.example.json --dry-run

# Importar para a BD (usa .env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
pnpm menu:import caminho/para/menu.json
```

Por baixo chama a RPC `import_menu(p_payload jsonb)` (idempotente, `authenticated`), pelo que o
mesmo botão "Importar" pode existir em **qualquer admin UI** futura, independente do design.

Exemplo completo: [`examples/menu.example.json`](../examples/menu.example.json).
