// FUNÇÃO OBSOLETA — one-off (desculpa ao pedido #113, 2026-06-06). Desativada.
// Esta versão existe apenas para remover a SMTP_PASS hardcoded do deploy anterior.
// Recomendado: apagar a função no painel Supabase.
Deno.serve(() =>
  new Response(JSON.stringify({ error: 'Gone' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  })
);
