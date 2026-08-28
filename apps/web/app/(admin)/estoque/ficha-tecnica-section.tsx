'use client';

/**
 * Estoque → Ficha técnica.
 *
 * Diz o que cada produto gasta. É isto que faz a venda descontar carne em vez
 * de descontar "Classic Smash" — e é por aqui que se corrige quando a cozinha
 * muda a receita.
 *
 * A linha "todas as variantes" vale para HAW e WAGYU (o queijo é o mesmo); a
 * linha com variante vale só para ela (é o que separa a carne RAW da WAGYU).
 *
 * Só o dono edita: mudar uma ficha muda a margem e o inventário de tudo o que
 * vier a seguir.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { createClient } from '@/utils/supabase/client';

type RecipeRow = {
  recipe_item_id: string;
  menu_item_id: string;
  item_name: string;
  variant_id: string | null;
  variant_name: string | null;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  qty: number;
  cost_cents: number;
};

type MenuItem = { id: string; name: string; price_cents: number; sort: number };
type Variant = { id: string; menu_item_id: string; name: string; price_cents: number };
type Ingredient = { id: string; name: string; cost_cents: number };

const mt = (value: number) => formatMT(value as Cents);

export default function FichaTecnicaSection() {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const [formItem, setFormItem] = useState('');
  const [formVariant, setFormVariant] = useState('');
  const [formIngredient, setFormIngredient] = useState('');
  const [formQty, setFormQty] = useState('1');

  useEffect(() => {
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) return;
      const { data } = await supabase
        .from('staff_profiles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
      setIsOwner(data?.role === 'owner');
    })();
  }, [supabase]);

  const refresh = useCallback(async () => {
    const [recipes, menu, variantList, ingredientList] = await Promise.all([
      supabase.rpc('list_recipes'),
      supabase.from('menu_items').select('id,name,price_cents,sort').order('sort'),
      supabase
        .from('menu_item_variants')
        .select('id,menu_item_id,name,price_cents')
        .eq('active', true)
        .order('sort'),
      supabase.from('ingredients').select('id,name,cost_cents').eq('active', true).order('sort'),
    ]);

    if (recipes.error) {
      setMessage({ tone: 'error', text: `Não foi possível carregar a ficha técnica: ${recipes.error.message}` });
    } else {
      setRows((recipes.data ?? []) as RecipeRow[]);
    }
    if (!menu.error) setItems((menu.data ?? []) as MenuItem[]);
    if (!variantList.error) setVariants((variantList.data ?? []) as Variant[]);
    if (!ingredientList.error) setIngredients((ingredientList.data ?? []) as Ingredient[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Produto → variante → linhas. A chave 'base' é a ficha que vale para todas.
  const porProduto = useMemo(() => {
    const mapa = new Map<string, { name: string; grupos: Map<string, RecipeRow[]> }>();
    for (const row of rows) {
      const produto = mapa.get(row.menu_item_id) ?? { name: row.item_name, grupos: new Map() };
      const chave = row.variant_id ?? 'base';
      produto.grupos.set(chave, [...(produto.grupos.get(chave) ?? []), row]);
      mapa.set(row.menu_item_id, produto);
    }
    return mapa;
  }, [rows]);

  // Produtos sem ficha nenhuma: vendem-se sem descontar matéria-prima.
  const semFicha = items.filter((item) => !porProduto.has(item.id));

  const variantesDoForm = variants.filter((variant) => variant.menu_item_id === formItem);

  function custoDoProduto(menuItemId: string, variantId: string | null): number {
    return rows
      .filter(
        (row) =>
          row.menu_item_id === menuItemId &&
          (row.variant_id === null || row.variant_id === variantId),
      )
      .reduce((total, row) => total + row.cost_cents, 0);
  }

  async function addRow() {
    if (!formItem || !formIngredient) {
      setMessage({ tone: 'error', text: 'Escolhe o produto e o ingrediente.' });
      return;
    }
    const qty = Number.parseInt(formQty, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      setMessage({ tone: 'error', text: 'A quantidade tem de ser um número inteiro maior que zero.' });
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc('save_recipe_item', {
      p_menu_item_id: formItem,
      p_ingredient_id: formIngredient,
      p_qty: qty,
      p_variant_id: formVariant || null,
    });
    setBusy(false);

    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('recipe_access_denied')
          ? 'Só o dono pode mexer na ficha técnica.'
          : error.message.includes('variant_not_in_item')
            ? 'Essa variante é de outro produto.'
            : `Recusado: ${error.message}`,
      });
      return;
    }

    setMessage({ tone: 'ok', text: 'Ficha actualizada. Vale para as vendas a partir de agora.' });
    await refresh();
  }

  async function removeRow(row: RecipeRow) {
    setBusy(true);
    const { error } = await supabase.rpc('delete_recipe_item', { p_id: row.recipe_item_id });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível remover: ${error.message}` });
      return;
    }
    await refresh();
  }

  return (
    <div className="space-y-6">
      {message && (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.tone === 'ok'
              ? 'border-[#2f6b3f] bg-[#16281c] text-[#a8e0b6]'
              : 'border-[#7a2b2b] bg-[#2a1616] text-[#ffb0b0]'
          }`}
        >
          {message.text}
        </p>
      )}

      {semFicha.length > 0 && (
        <section className="rounded-2xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.07] p-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-[#e5a93c]">
            Sem ficha técnica · {semFicha.length}
          </h2>
          <p className="mt-1 text-sm text-[#C9BCAC]">
            {semFicha.map((item) => item.name).join(' · ')} — estes vendem-se sem descontar
            matéria-prima nenhuma e entram no CMV com custo zero.
          </p>
        </section>
      )}

      {loading && <p className="text-sm text-[#8b8378]">A carregar a ficha técnica…</p>}

      <div className="space-y-4">
        {[...porProduto.entries()].map(([menuItemId, produto]) => {
          const base = produto.grupos.get('base') ?? [];
          const porVariante = [...produto.grupos.entries()].filter(([chave]) => chave !== 'base');
          const item = items.find((entry) => entry.id === menuItemId);

          return (
            <section key={menuItemId} className="rounded-2xl border border-white/[0.08]">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                <h2 className="font-black text-white">{produto.name}</h2>
                {item && (
                  <span className="text-xs text-[#8b8378]">
                    venda {mt(item.price_cents)}
                    {porVariante.length === 0 && (
                      <>
                        {' '}
                        · custo {mt(custoDoProduto(menuItemId, null))} · margem{' '}
                        <strong className="text-[#a8e0b6]">
                          {mt(item.price_cents - custoDoProduto(menuItemId, null))}
                        </strong>
                      </>
                    )}
                  </span>
                )}
              </header>

              {base.length > 0 && (
                <div className="border-b border-white/[0.06] px-4 py-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-[#8b8378]">
                    Todas as variantes
                  </span>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {base.map((row) => (
                      <li
                        key={row.recipe_item_id}
                        className="flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-xs text-[#C9BCAC]"
                      >
                        <span className="font-bold text-white">
                          {row.qty}× {row.ingredient_name}
                        </span>
                        <span>{mt(row.cost_cents)}</span>
                        {isOwner && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeRow(row)}
                            className="text-[#ff9b9b] disabled:opacity-50"
                            aria-label={`Remover ${row.ingredient_name}`}
                          >
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {porVariante.map(([variantId, linhas]) => {
                const custo = custoDoProduto(menuItemId, variantId);
                // O preço da variante SUBSTITUI o do item base (CLAUDE §7.2).
                const preco = variants.find((entry) => entry.id === variantId)?.price_cents ?? 0;
                return (
                  <div key={variantId} className="border-b border-white/[0.06] px-4 py-3 last:border-b-0">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#e5a93c]">
                      {linhas[0].variant_name}
                    </span>
                    <ul className="mt-2 flex flex-wrap items-center gap-2">
                      {linhas.map((row) => (
                        <li
                          key={row.recipe_item_id}
                          className="flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-xs text-[#C9BCAC]"
                        >
                          <span className="font-bold text-white">
                            {row.qty}× {row.ingredient_name}
                          </span>
                          <span>{mt(row.cost_cents)}</span>
                          {isOwner && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void removeRow(row)}
                              className="text-[#ff9b9b] disabled:opacity-50"
                              aria-label={`Remover ${row.ingredient_name}`}
                            >
                              ×
                            </button>
                          )}
                        </li>
                      ))}
                      <li className="text-xs text-[#8b8378]">
                        custo <strong className="text-white">{mt(custo)}</strong>
                        {preco > 0 && (
                          <>
                            {' '}· venda {mt(preco)} · margem{' '}
                            <strong className="text-[#a8e0b6]">{mt(preco - custo)}</strong>
                          </>
                        )}
                      </li>
                    </ul>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      {isOwner && (
        <section className="rounded-2xl border border-white/[0.08] p-4">
          <h2 className="font-black text-white">Acrescentar à ficha</h2>
          <p className="mt-1 text-sm text-[#8b8378]">
            Deixa a variante em <strong>Todas</strong> quando o ingrediente é igual em todas elas.
            Escolhe uma variante quando o que muda é a carne.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={formItem}
              onChange={(event) => {
                setFormItem(event.target.value);
                setFormVariant('');
              }}
              className="min-w-48 flex-1 rounded-xl border border-white/10 bg-[#141210] px-4 py-2 text-sm text-white"
            >
              <option value="">Produto…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>

            <select
              value={formVariant}
              onChange={(event) => setFormVariant(event.target.value)}
              disabled={variantesDoForm.length === 0}
              className="min-w-40 rounded-xl border border-white/10 bg-[#141210] px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              <option value="">Todas as variantes</option>
              {variantesDoForm.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.name}
                </option>
              ))}
            </select>

            <select
              value={formIngredient}
              onChange={(event) => setFormIngredient(event.target.value)}
              className="min-w-48 flex-1 rounded-xl border border-white/10 bg-[#141210] px-4 py-2 text-sm text-white"
            >
              <option value="">Ingrediente…</option>
              {ingredients.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>
                  {ingredient.name}
                  {ingredient.cost_cents === 0 ? ' (custo por preencher)' : ` · ${mt(ingredient.cost_cents)}`}
                </option>
              ))}
            </select>

            <input
              value={formQty}
              onChange={(event) => setFormQty(event.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              className="w-24 rounded-xl border border-white/10 bg-[#141210] px-4 py-2 text-sm font-black text-white"
            />

            <button
              type="button"
              disabled={busy}
              onClick={() => void addRow()}
              className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
