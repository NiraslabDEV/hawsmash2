// Guarda de go-live: nenhum dado inventado pode chegar a produção.
// Ver AGENTS.md §1.5 — placeholders são detectáveis de propósito.

export const PLACEHOLDER_PREFIX = 'PLACEHOLDER_';

/**
 * Percorre linhas `{ table, column, id, value }` e devolve as que ainda têm
 * um valor de marcador. Uma lista vazia é a condição para abrir as lojas.
 */
export function findPlaceholders(rows) {
  return rows.filter(
    (row) => typeof row.value === 'string' && row.value.includes(PLACEHOLDER_PREFIX),
  );
}

/** Mensagem única, pronta a colar na checklist de abertura. */
export function describePlaceholders(found) {
  if (found.length === 0) return 'Sem placeholders: pronto para abrir.';
  return found
    .map((row) => `${row.table}.${row.column} (${row.id ?? 'sem id'}): ${row.value}`)
    .join('\n');
}
