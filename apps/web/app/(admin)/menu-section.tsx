'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  formatMT as coreFormatMT,
  buildCategoryTree,
  collectDescendantIds,
  findNode,
  type Cents,
  type CategoryTreeNode,
} from '@delivery/core';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  station: string;
  sort: number;
  active: boolean;
  photo_url: string | null;
  parent_id: string | null;
}

interface Item {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  photo_url: string | null;
  available: boolean;
  available_delivery: boolean;
  is_upsell: boolean;
  available_dine_in: boolean;
  track_stock: boolean;
  stock_qty: number;
  sort: number;
}

/**
 * Em que lojas cada produto aparece.
 *
 * O catálogo (`menu_items`) é da empresa e é um só; quem decide se o produto
 * existe NAQUELA loja é `store_items.available` (CLAUDE §5.3). Sem este ecrã,
 * essa coluna só se mexia por SQL — e o cardápio era forçosamente igual nas
 * duas lojas.
 */
interface Store {
  id: string;
  short_name: string;
}

/** Chave `${store_id}:${menu_item_id}` → aparece nesta loja. */
type StoreAvailability = Record<string, boolean>;

interface Zone {
  id: string;
  name: string;
  fee_cents: number;
  active: boolean;
  sort: number;
}

interface Variant {
  id: string;
  menu_item_id: string;
  name: string;
  price_cents: number;
  sort: number;
  is_default: boolean;
  active: boolean;
}

interface Addon {
  id: string;
  menu_item_id: string;
  name: string;
  price_cents: number;
  sort: number;
  active: boolean;
}

const STATIONS = [
  { value: 'kitchen',      label: 'Cozinha' },
  { value: 'bar',          label: 'Bar' },
  { value: 'cold_kitchen', label: 'Cozinha fria' },
] as const;

export function stationLabel(value: string): string {
  return STATIONS.find((s) => s.value === value)?.label ?? value;
}

// DECISÃO: usar o formatMT canónico de @delivery/core (dá "MT 250,00").
// Intl currency:'MZN' dava "MTn 250,00" — proibido no CLAUDE.md.
const formatMT = (cents: number) => coreFormatMT(cents as Cents);

const decimalStringToCents = (str: string): number => {
  const num = parseFloat(str);
  if (isNaN(num)) throw new Error('Invalid number');
  return Math.round(num * 100);
};

const centsToDecimalString = (cents: number): string => {
  return (cents / 100).toFixed(2);
};

// ─── Secção ───────────────────────────────────────────────────────────────────

export function MenuSection() {
  const supabase = createClient();
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'menu' | 'zones'>('menu');
  
  // Menu state
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [editingItem, setEditingItem] = useState<Item | 'new' | null>(null);
  const [editingItemCategory, setEditingItemCategory] = useState<string>('');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  // categoria-mãe (§ categorias hierárquicas): id da categoria a receber uma
  // nova subcategoria, ou null quando o formulário no topo cria uma de raiz.
  const [addingChildTo, setAddingChildTo] = useState<string | null>(null);
  // categorias colapsadas por padrão (cardápio tem muitos produtos) — só
  // guarda os ids expandidos; toda categoria nova nasce colapsada.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const collapsed = useCallback((id: string) => !expanded.has(id), [expanded]);
  const toggleCollapsed = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const [stores, setStores] = useState<Store[]>([]);
  const [storeAvailability, setStoreAvailability] = useState<StoreAvailability>({});

  // Zones state
  const [zones, setZones] = useState<Zone[]>([]);
  const [editingZone, setEditingZone] = useState<Zone | 'new' | null>(null);

  const [error, setError] = useState('');

  // Refetch functions
  const refetchMenu = useCallback(async () => {
    const [{ data: cats }, { data: its }, { data: lojas }, { data: si }] = await Promise.all([
      supabase.from('menu_categories').select('id, name, station, sort, active, photo_url, parent_id').order('sort'),
      supabase.from('menu_items')
        .select('id, category_id, name, description, price_cents, photo_url, available, available_delivery, available_dine_in, track_stock, stock_qty, is_upsell, sort')
        .order('sort'),
      supabase.from('stores').select('id, short_name').eq('active', true).order('sort'),
      supabase.from('store_items').select('store_id, menu_item_id, available'),
    ]);
    setCategories((cats ?? []) as Category[]);
    setItems((its ?? []) as Item[]);
    setStores((lojas ?? []) as Store[]);

    const mapa: StoreAvailability = {};
    for (const linha of (si ?? []) as { store_id: string; menu_item_id: string; available: boolean }[]) {
      mapa[`${linha.store_id}:${linha.menu_item_id}`] = linha.available;
    }
    setStoreAvailability(mapa);
  }, [supabase]);

  const refetchZones = useCallback(async () => {
    const { data } = await supabase.from('delivery_zones')
      .select('id, name, fee_cents, active, sort')
      .order('sort');
    setZones((data ?? []) as Zone[]);
  }, [supabase]);

  useEffect(() => {
    refetchMenu();
    refetchZones();
  }, [refetchMenu, refetchZones]);

  // ─── Menu CRUD ─────────────────────────────────────────────────────────────
  
  async function addCategory(name: string, station: string, parentId: string | null = null) {
    setError('');
    const maxSort = Math.max(0, ...categories.map((c) => c.sort));
    const { error: err } = await supabase.from('menu_categories').insert({
      name, station, sort: maxSort + 1, active: true, parent_id: parentId,
    });
    if (err) { setError(`Erro ao criar categoria: ${err.message}`); return; }
    refetchMenu();
  }

  async function updateCategory(category: Category) {
    setError('');
    const { error: err } = await supabase
      .from('menu_categories')
      .update({
        name: category.name, station: category.station, active: category.active,
        photo_url: category.photo_url, parent_id: category.parent_id,
      })
      .eq('id', category.id);
    if (err) { setError(`Erro ao atualizar categoria: ${err.message}`); return; }
    refetchMenu();
  }

  async function deleteCategory(id: string) {
    if (!confirm('Apagar esta categoria e TODOS os seus itens?')) return;
    const { error: err } = await supabase.from('menu_categories').delete().eq('id', id);
    if (err) { setError(`Erro: ${err.message}`); return; }
    refetchMenu();
  }

  async function toggleAvailable(item: Item) {
    const { error: err } = await supabase
      .from('menu_items')
      .update({ available: !item.available })
      .eq('id', item.id);
    if (err) { setError(`Erro: ${err.message}`); return; }
    refetchMenu();
  }

  /**
   * Liga/desliga um produto numa loja concreta.
   *
   * Escreve em `store_items.available` — a mesma coluna que o `get_menu` do
   * site e o `create_counter_sale` do POS já consultam. Desligar aqui tira o
   * produto do cardápio DAQUELA loja e impede que o balcão o venda, sem tocar
   * no catálogo da outra.
   *
   * Actualiza o ecrã primeiro e reverte se o servidor recusar: no touch, um
   * botão que só reage depois da ida à rede parece avariado e leva segundo
   * toque — que desfazia o primeiro.
   */
  async function toggleStoreAvailability(storeId: string, item: Item) {
    const chave = `${storeId}:${item.id}`;
    const anterior = storeAvailability[chave] ?? true;
    setStoreAvailability((atual) => ({ ...atual, [chave]: !anterior }));

    // `.select()` devolve as linhas afectadas. Sem isto, um update recusado
    // pela RLS (um gerente a mexer numa loja que não é dele) voltava como
    // sucesso com zero linhas — e o botão ficava verde a mentir.
    const { data, error: err } = await supabase
      .from('store_items')
      .update({ available: !anterior })
      .eq('store_id', storeId)
      .eq('menu_item_id', item.id)
      .select('store_id');

    if (err || !data?.length) {
      setStoreAvailability((atual) => ({ ...atual, [chave]: anterior }));
      setError(
        err
          ? `Não foi possível mudar a disponibilidade: ${err.message}`
          : 'Não tens acesso a essa loja, ou o produto ainda não lá existe.',
      );
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Apagar este item?')) return;
    const { error: err } = await supabase.from('menu_items').delete().eq('id', id);
    if (err) { setError(`Erro: ${err.message}`); return; }
    refetchMenu();
  }

  // ─── Zones CRUD ─────────────────────────────────────────────────────────────
  
  async function saveZone(z: Zone) {
    setError('');
    // Nova zona = o id gerado no modal ainda não existe na lista carregada.
    const isNew = !zones.some((existing) => existing.id === z.id);

    const { error: err } = isNew
      ? await supabase.from('delivery_zones').insert({
          name: z.name,
          fee_cents: z.fee_cents,
          active: z.active,
          sort: Math.max(0, ...zones.map((x) => x.sort)) + 1,
        })
      : await supabase
          .from('delivery_zones')
          .update({ name: z.name, fee_cents: z.fee_cents, active: z.active })
          .eq('id', z.id);

    if (err) { setError(`Erro ao guardar zona: ${err.message}`); return; }
    refetchZones();
  }

  async function deleteZone(id: string) {
    if (!confirm('Apagar esta zona?')) return;
    const { error: err } = await supabase.from('delivery_zones').delete().eq('id', id);
    if (err) { setError(`Erro: ${err.message}`); return; }
    refetchZones();
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-sm text-[#F5A623] bg-[#F5A623]/10 border border-[#F5A623]/30 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('menu')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'menu'
              ? 'bg-[#F5A623] text-[#2A1710]'
              : 'bg-black/20 text-[#C9BCAC] hover:text-[#F3E4CE]'
          }`}
        >
          Cardápio
        </button>
        <button
          onClick={() => setActiveTab('zones')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'zones'
              ? 'bg-[#F5A623] text-[#2A1710]'
              : 'bg-black/20 text-[#C9BCAC] hover:text-[#F3E4CE]'
          }`}
        >
          Zonas de Entrega
        </button>
      </div>

      {/* Menu Tab */}
      {activeTab === 'menu' && (
        <div className="space-y-6">
          <NewCategoryForm onAdd={(name, station) => addCategory(name, station, null)} />

          {categories.length === 0 && (
            <p className="text-gray-400 text-center py-8">Sem categorias. Cria a primeira acima.</p>
          )}

          {buildCategoryTree(categories).map((node) => (
            <CategoryBranch
              key={node.id}
              node={node}
              depth={0}
              items={items}
              addingChildTo={addingChildTo}
              collapsed={collapsed}
              onToggleCollapsed={toggleCollapsed}
              onSetAddingChildTo={setAddingChildTo}
              onAddChild={(parentId, name, station) => { addCategory(name, station, parentId); setAddingChildTo(null); }}
              onAddItem={(catId) => { setEditingItem('new'); setEditingItemCategory(catId); }}
              onEditCategory={setEditingCategory}
              onDeleteCategory={deleteCategory}
              onEditItem={(item, catId) => { setEditingItem(item); setEditingItemCategory(catId); }}
              onToggleAvailable={toggleAvailable}
              onDeleteItem={deleteItem}
              stores={stores}
              storeAvailability={storeAvailability}
              onToggleStoreAvailability={toggleStoreAvailability}
            />
          ))}
        </div>
      )}

      {/* Zones Tab */}
      {activeTab === 'zones' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-[#F5A623]">Zonas de Entrega</h3>
            <button
              onClick={() => setEditingZone('new')}
              className="bg-[#F5A623] text-[#2A1710] text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#D6860F] transition-colors"
            >
              + Nova Zona
            </button>
          </div>

          {zones.length === 0 && (
            <p className="text-gray-400 text-center py-8">Sem zonas de entrega.</p>
          )}

          {zones.map((zone) => (
            <div key={zone.id} className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className={`font-semibold ${zone.active ? 'text-white' : 'text-gray-500 line-through'}`}>
                  {zone.name}
                </p>
                <p className="text-[#F5A623] font-bold text-sm">{formatMT(zone.fee_cents)}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingZone(zone)}
                  className="text-[#C9BCAC] text-sm px-2 hover:text-white"
                >
                  Editar
                </button>
                <button
                  onClick={() => deleteZone(zone.id)}
                  className="text-red-400 text-sm px-1 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {editingItem && (
        <ItemModal
          item={editingItem === 'new' ? null : editingItem}
          categoryId={editingItemCategory}
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); refetchMenu(); }}
        />
      )}

      {editingCategory && (
        <CategoryModal
          category={editingCategory}
          allCategories={categories}
          onClose={() => setEditingCategory(null)}
          onSaved={(c) => { updateCategory(c); setEditingCategory(null); }}
        />
      )}

      {editingZone && (
        <ZoneModal
          zone={editingZone}
          onClose={() => setEditingZone(null)}
          onSaved={(z) => { saveZone(z); setEditingZone(null); }}
        />
      )}
    </div>
  );
}

// ─── Categoria hierárquica (categoria-mãe → subcategorias) ────────────────────
// Renderiza um nó da árvore (buildCategoryTree, @delivery/core) e recursivamente
// os filhos, indentados — profundidade arbitrária (Bebidas → Alcoólicas →
// Destilados → Whisky, etc.).

function CategoryBranch({
  node, depth, items, addingChildTo, collapsed, onToggleCollapsed,
  onSetAddingChildTo, onAddChild, onAddItem, onEditCategory, onDeleteCategory,
  onEditItem, onToggleAvailable, onDeleteItem,
  stores, storeAvailability, onToggleStoreAvailability,
}: {
  node: CategoryTreeNode<Category>;
  depth: number;
  items: Item[];
  addingChildTo: string | null;
  collapsed: (id: string) => boolean;
  onToggleCollapsed: (id: string) => void;
  onSetAddingChildTo: (id: string | null) => void;
  onAddChild: (parentId: string, name: string, station: string) => void;
  onAddItem: (categoryId: string) => void;
  onEditCategory: (cat: Category) => void;
  onDeleteCategory: (id: string) => void;
  onEditItem: (item: Item, categoryId: string) => void;
  onToggleAvailable: (item: Item) => void;
  onDeleteItem: (id: string) => void;
  stores: Store[];
  storeAvailability: StoreAvailability;
  onToggleStoreAvailability: (storeId: string, item: Item) => void;
}) {
  const cat = node;
  const ownItems = items.filter((i) => i.category_id === cat.id);
  const isCollapsed = collapsed(cat.id);

  return (
    <div style={depth > 0 ? { marginLeft: 20, borderLeft: '2px solid rgba(245,166,35,0.25)', paddingLeft: 14 } : undefined}>
      <section className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-xl overflow-hidden">
        <div
          className="px-4 py-3 bg-black/20 flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none"
          onClick={() => onToggleCollapsed(cat.id)}
        >
          <div className="flex items-center gap-2">
            <span className={`text-[#C9BCAC] text-xs transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
            <div>
              <h2 className={`font-bold text-lg ${cat.active ? 'text-white' : 'text-gray-500'}`}>
                {cat.name}
                {node.children.length > 0 && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold text-[#C9BCAC] align-middle">
                    categoria-mãe · {node.children.length} sub
                  </span>
                )}
                {ownItems.length > 0 && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold text-[#C9BCAC] align-middle">
                    {ownItems.length} {ownItems.length === 1 ? 'item' : 'itens'}
                  </span>
                )}
              </h2>
              <p className="text-xs text-[#C9BCAC]">{stationLabel(cat.station)}</p>
            </div>
          </div>
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onSetAddingChildTo(addingChildTo === cat.id ? null : cat.id)}
              className="text-[#C9BCAC] text-sm font-semibold px-3 py-1.5 rounded-lg border border-white/[0.08] hover:text-white transition-colors"
            >
              + Subcategoria
            </button>
            <button
              onClick={() => onAddItem(cat.id)}
              className="bg-[#F5A623] text-[#2A1710] text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-[#D6860F] transition-colors"
            >
              + Item
            </button>
            <button
              onClick={() => onEditCategory(cat)}
              className="text-[#C9BCAC] text-sm px-2 hover:text-white"
              aria-label={`Editar ${cat.name}`}
            >
              ✎
            </button>
            <button
              onClick={() => onDeleteCategory(cat.id)}
              className="text-red-400 text-sm px-1 hover:text-red-300"
              aria-label={`Apagar ${cat.name}`}
            >
              ✕
            </button>
          </div>
        </div>

        {!isCollapsed && addingChildTo === cat.id && (
          <div className="px-4 py-3 bg-black/10 border-t border-white/[0.06]">
            <NewCategoryForm onAdd={(name, station) => onAddChild(cat.id, name, station)} compact />
          </div>
        )}

        {!isCollapsed && ownItems.length > 0 && (
          <ul className="divide-y divide-white/[0.06]">
            {ownItems.map((item) => (
              <li key={item.id} className="px-4 py-3 flex items-center gap-3">
                {item.photo_url ? (
                  <img src={item.photo_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-white/[0.08] shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm ${item.available ? 'text-white' : 'text-gray-500 line-through'}`}>
                    {item.name}
                  </p>
                  <p className="text-[#F5A623] font-bold text-sm">{formatMT(item.price_cents)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-[#C9BCAC]/70">
                    {item.available_delivery && item.available_dine_in
                      ? 'Delivery + QR Mesa'
                      : item.available_delivery
                        ? 'Só Delivery'
                        : item.available_dine_in
                          ? 'Só QR Mesa'
                          : '⚠️ Nenhum canal'}
                  </p>
                  {item.track_stock && (
                    <p className="text-xs text-[#C9BCAC]">
                      Estoque: {item.stock_qty} {item.stock_qty <= 5 && '⚠️'}
                    </p>
                  )}

                  {/* Em que lojas este produto aparece. Um botão por loja: com
                      duas lojas, uma lista seria mais cliques para a mesma
                      decisão. Desligado = fora do cardápio e do POS dessa loja. */}
                  {stores.length > 1 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {stores.map((store) => {
                        const naLoja = storeAvailability[`${store.id}:${item.id}`] ?? true;
                        return (
                          <button
                            key={store.id}
                            type="button"
                            onClick={() => onToggleStoreAvailability(store.id, item)}
                            aria-pressed={naLoja}
                            title={
                              naLoja
                                ? `Aparece em ${store.short_name} — clica para esconder`
                                : `Escondido em ${store.short_name} — clica para mostrar`
                            }
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                              naLoja
                                ? 'border-green-700 bg-green-900/30 text-green-300'
                                : 'border-white/10 bg-white/[0.04] text-[#6f6a62] line-through'
                            }`}
                          >
                            {store.short_name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onToggleAvailable(item)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
                    item.available ? 'bg-green-900/30 text-green-400 border border-green-700' : 'bg-white/[0.08] text-[#C9BCAC]'
                  }`}
                >
                  {item.available ? 'Disponível' : 'Esgotado'}
                </button>
                <button
                  onClick={() => onEditItem(item, cat.id)}
                  className="text-[#C9BCAC] text-sm px-2 hover:text-white"
                >
                  Editar
                </button>
                <button onClick={() => onDeleteItem(item.id)} className="text-red-400 text-sm px-1 hover:text-red-300">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!isCollapsed && node.children.length > 0 && (
        <div className="mt-3 space-y-3">
          {node.children.map((child) => (
            <CategoryBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              items={items}
              addingChildTo={addingChildTo}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onSetAddingChildTo={onSetAddingChildTo}
              onAddChild={onAddChild}
              onAddItem={onAddItem}
              onEditCategory={onEditCategory}
              onDeleteCategory={onDeleteCategory}
              onEditItem={onEditItem}
              onToggleAvailable={onToggleAvailable}
              onDeleteItem={onDeleteItem}
              stores={stores}
              storeAvailability={storeAvailability}
              onToggleStoreAvailability={onToggleStoreAvailability}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Form de nova categoria ───────────────────────────────────────────────────

function NewCategoryForm({ onAdd, compact }: { onAdd: (name: string, station: string) => void; compact?: boolean }) {
  const [name, setName] = useState('');
  const [station, setStation] = useState<string>('kitchen');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim(), station);
        setName('');
      }}
      className={compact
        ? 'flex gap-2 items-end flex-wrap'
        : 'border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-xl p-4 flex gap-2 items-end flex-wrap'}
    >
      <div className="flex-1 min-w-[160px]">
        <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">
          {compact ? 'Nova subcategoria' : 'Nova categoria'}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: Pratos principais"
          className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-[#C9BCAC] focus:outline-none focus:border-[#F5A623]"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Estação</label>
        <select
          value={station}
          onChange={(e) => setStation(e.target.value)}
          className="bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
        >
          {STATIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="bg-[#F5A623] text-[#2A1710] text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#D6860F] transition-colors"
      >
        {compact ? '+ Adicionar' : 'Criar'}
      </button>
    </form>
  );
}

// ─── Modal de item (criar/editar + upload de foto + estoque) ──────────────────

function ItemModal({
  item, categoryId, onClose, onSaved,
}: {
  item: Item | null;
  categoryId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [priceMT, setPriceMT] = useState(
    item ? centsToDecimalString(item.price_cents) : ''
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [trackStock, setTrackStock] = useState(item?.track_stock ?? false);
  const [stockQty, setStockQty] = useState(item?.stock_qty ?? 0);
  const [availableDelivery, setAvailableDelivery] = useState(item?.available_delivery ?? true);
  const [availableDineIn, setAvailableDineIn] = useState(item?.available_dine_in ?? true);
  const [isUpsell, setIsUpsell] = useState(item?.is_upsell ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Preço em MT → centavos (única conversão; nunca float no banco)
    let priceCents: number;
    try {
      priceCents = decimalStringToCents(priceMT.replace(',', '.'));
    } catch {
      setError('Preço inválido. Usa o formato 250.00');
      return;
    }

    if (!availableDelivery && !availableDineIn) {
      setError('O prato tem de estar disponível em pelo menos um canal (Delivery ou QR Mesa).');
      return;
    }

    setSaving(true);

    // Upload da foto (path: {uuid}.{ext})
    let photoUrl = item?.photo_url ?? null;
    if (photoFile) {
      const ext = photoFile.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('menu-photos')
        .upload(path, photoFile, { cacheControl: '3600', upsert: false });
      if (upErr) {
        setError(`Erro no upload da foto: ${upErr.message}`);
        setSaving(false);
        return;
      }
      photoUrl = supabase.storage.from('menu-photos').getPublicUrl(path).data.publicUrl;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      price_cents: priceCents,
      photo_url: photoUrl,
      track_stock: trackStock,
      stock_qty: trackStock ? stockQty : 0,
      available_delivery: availableDelivery,
      available_dine_in: availableDineIn,
      is_upsell: isUpsell,
    };

    const { error: err } = item
      ? await supabase.from('menu_items').update(payload).eq('id', item.id)
      : await supabase.from('menu_items').insert({
          ...payload,
          category_id: categoryId,
          available: true,
        });

    setSaving(false);
    if (err) { setError(`Erro ao guardar: ${err.message}`); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-50 flex items-center justify-center p-4">
      <form
        onSubmit={handleSave}
        className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-2xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-bold text-lg text-[#F5A623]">
          {item ? 'Editar item' : 'Novo item'}
        </h2>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
            placeholder="ex: Frango grelhado"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Descrição</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
            placeholder="ex: Com batata frita e salada"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Preço (MT)</label>
          <input
            value={priceMT}
            onChange={(e) => setPriceMT(e.target.value)}
            required
            inputMode="decimal"
            className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
            placeholder="ex: 250.00"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Foto</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-[#C9BCAC]"
          />
          {item?.photo_url && !photoFile && (
            <p className="text-xs text-[#C9BCAC] mt-1">Já tem foto. Escolhe outra para substituir.</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Canal</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#C9BCAC]">
              <input
                type="checkbox"
                checked={availableDelivery}
                onChange={(e) => setAvailableDelivery(e.target.checked)}
                className="rounded bg-black/20 border-white/[0.08] text-[#F5A623] focus:ring-[#F5A623]"
              />
              Delivery
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-[#C9BCAC]">
              <input
                type="checkbox"
                checked={availableDineIn}
                onChange={(e) => setAvailableDineIn(e.target.checked)}
                className="rounded bg-black/20 border-white/[0.08] text-[#F5A623] focus:ring-[#F5A623]"
              />
              QR Mesa
            </label>
          </div>
          <p className="text-[11px] text-[#C9BCAC]/70 mt-1">
            Escolhe onde este prato aparece — só no delivery, só na mesa, ou em ambos.
          </p>
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[#C9BCAC]">
            <input
              type="checkbox"
              checked={isUpsell}
              onChange={(e) => setIsUpsell(e.target.checked)}
              className="rounded bg-black/20 border-white/[0.08] text-[#F5A623] focus:ring-[#F5A623]"
            />
            Oferecer no fim do pedido
          </label>
          <p className="text-[11px] text-[#C9BCAC]/70 mt-1">
            Aparece no ecrã que surge entre o carrinho e o pagamento (bebidas, batatas,
            sobremesas). Quem já leva um destes não volta a ser incomodado.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="trackStock"
              checked={trackStock}
              onChange={(e) => setTrackStock(e.target.checked)}
              className="rounded bg-black/20 border-white/[0.08] text-[#F5A623] focus:ring-[#F5A623]"
            />
            <label htmlFor="trackStock" className="text-xs font-semibold text-[#C9BCAC]">
              Controlar estoque
            </label>
          </div>
          
          {trackStock && (
            <div>
              <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Quantidade em estoque</label>
              <input
                type="number"
                min="0"
                value={stockQty}
                onChange={(e) => setStockQty(parseInt(e.target.value) || 0)}
                className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
              />
            </div>
          )}
        </div>

        {/* Tamanhos + Adicionais (opcional). Só para item já guardado, pois
            referenciam menu_item_id. Sem nenhum → item fica "simples". */}
        {item ? (
          <OptionsEditor itemId={item.id} />
        ) : (
          <p className="text-xs text-[#C9BCAC] border-t border-white/[0.08] pt-3">
            Guarda o item primeiro para adicionar <strong>Tamanhos</strong> e <strong>Adicionais</strong> (opcional).
          </p>
        )}

        {error && (
          <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-white/[0.08] text-[#C9BCAC] font-semibold py-3 rounded-xl text-sm hover:bg-white/[0.08] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-[#F5A623] text-[#2A1710] font-bold py-3 rounded-xl text-sm disabled:opacity-60 hover:bg-[#D6860F] transition-colors"
          >
            {saving ? 'A guardar…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Editor de Tamanhos + Adicionais (inline, dentro do ItemModal) ─────────────

function OptionsEditor({ itemId }: { itemId: string }) {
  const supabase = createClient();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [err, setErr] = useState('');

  const refetch = useCallback(async () => {
    const [{ data: vs }, { data: as }] = await Promise.all([
      supabase.from('menu_item_variants')
        .select('id, menu_item_id, name, price_cents, sort, is_default, active')
        .eq('menu_item_id', itemId).order('sort'),
      supabase.from('menu_addons')
        .select('id, menu_item_id, name, price_cents, sort, active')
        .eq('menu_item_id', itemId).order('sort'),
    ]);
    setVariants((vs ?? []) as Variant[]);
    setAddons((as ?? []) as Addon[]);
  }, [supabase, itemId]);

  useEffect(() => { refetch(); }, [refetch]);

  async function addVariant(name: string, priceCents: number) {
    setErr('');
    const sort = Math.max(0, ...variants.map((v) => v.sort)) + 1;
    const { error } = await supabase.from('menu_item_variants').insert({
      menu_item_id: itemId, name, price_cents: priceCents, sort,
      is_default: variants.length === 0, active: true,
    });
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  async function deleteVariant(id: string) {
    const { error } = await supabase.from('menu_item_variants').delete().eq('id', id);
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  async function setDefaultVariant(id: string) {
    setErr('');
    // Só um is_default por item: limpar os outros, marcar este.
    await supabase.from('menu_item_variants').update({ is_default: false }).eq('menu_item_id', itemId);
    const { error } = await supabase.from('menu_item_variants').update({ is_default: true }).eq('id', id);
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  async function addAddon(name: string, priceCents: number) {
    setErr('');
    const sort = Math.max(0, ...addons.map((a) => a.sort)) + 1;
    const { error } = await supabase.from('menu_addons').insert({
      menu_item_id: itemId, name, price_cents: priceCents, sort, active: true,
    });
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  async function deleteAddon(id: string) {
    const { error } = await supabase.from('menu_addons').delete().eq('id', id);
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  return (
    <div className="border-t border-white/[0.08] pt-4 space-y-4">
      {err && <p className="text-sm text-red-400">{err}</p>}

      {/* Tamanhos */}
      <div>
        <p className="text-xs font-semibold text-[#C9BCAC] mb-2">
          Tamanhos <span className="font-normal">(escolha única — substitui o preço base)</span>
        </p>
        <ul className="space-y-1.5 mb-2">
          {variants.map((v) => (
            <li key={v.id} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setDefaultVariant(v.id)}
                title={v.is_default ? 'Padrão' : 'Tornar padrão'}
                className={`text-xs px-1.5 py-0.5 rounded ${v.is_default ? 'bg-[#F5A623] text-[#2A1710]' : 'bg-white/[0.08] text-[#C9BCAC]'}`}
              >
                {v.is_default ? '★ Padrão' : 'Tornar padrão'}
              </button>
              <span className="flex-1 text-white">{v.name}</span>
              <span className="text-[#F5A623] font-semibold">{formatMT(v.price_cents)}</span>
              <button type="button" onClick={() => deleteVariant(v.id)} className="text-red-400 px-1">✕</button>
            </li>
          ))}
          {variants.length === 0 && <li className="text-xs text-[#C9BCAC]">Sem tamanhos — item de preço único.</li>}
        </ul>
        <OptionAddRow placeholder="ex: Médio" onAdd={addVariant} />
      </div>

      {/* Adicionais */}
      <div>
        <p className="text-xs font-semibold text-[#C9BCAC] mb-2">
          Adicionais <span className="font-normal">(multi — somam ao preço)</span>
        </p>
        <ul className="space-y-1.5 mb-2">
          {addons.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 text-white">{a.name}</span>
              <span className="text-[#F5A623] font-semibold">+{formatMT(a.price_cents)}</span>
              <button type="button" onClick={() => deleteAddon(a.id)} className="text-red-400 px-1">✕</button>
            </li>
          ))}
          {addons.length === 0 && <li className="text-xs text-[#C9BCAC]">Sem adicionais.</li>}
        </ul>
        <OptionAddRow placeholder="ex: Chantilly" onAdd={addAddon} />
      </div>
    </div>
  );
}

function OptionAddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string, priceCents: number) => void }) {
  const [name, setName] = useState('');
  const [priceMT, setPriceMT] = useState('');

  function submit() {
    if (!name.trim()) return;
    let cents: number;
    try {
      cents = decimalStringToCents(priceMT.replace(',', '.'));
    } catch {
      cents = 0;
    }
    onAdd(name.trim(), cents);
    setName(''); setPriceMT('');
  }

  return (
    <div className="flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-black/20 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white placeholder-[#C9BCAC] focus:outline-none focus:border-[#F5A623]"
      />
      <input
        value={priceMT}
        onChange={(e) => setPriceMT(e.target.value)}
        inputMode="decimal"
        placeholder="MT"
        className="w-20 bg-black/20 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white placeholder-[#C9BCAC] focus:outline-none focus:border-[#F5A623]"
      />
      <button
        type="button"
        onClick={submit}
        className="bg-white/[0.08] text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-white/[0.14] transition-colors"
      >
        +
      </button>
    </div>
  );
}

// ─── Modal de categoria (editar) ───────────────────────────────────────────────

function CategoryModal({
  category, allCategories, onClose, onSaved,
}: {
  category: Category;
  allCategories: Category[];
  onClose: () => void;
  onSaved: (c: Category) => void;
}) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(category.name);
  const [station, setStation] = useState(category.station);
  const [active, setActive] = useState(category.active);
  const [photoUrl, setPhotoUrl] = useState<string | null>(category.photo_url);
  const [parentId, setParentId] = useState<string | null>(category.parent_id);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');

  // Categoria mãe: nunca a própria categoria nem nenhum dos seus descendentes
  // (senão cria um ciclo — o trigger da BD também recusa, isto é só UX).
  const invalidParentIds = (() => {
    const tree = buildCategoryTree(allCategories);
    const self = findNode(tree, category.id);
    const ids = self ? collectDescendantIds(self) : new Set<string>();
    ids.add(category.id);
    return ids;
  })();
  const parentOptions = allCategories.filter((c) => !invalidParentIds.has(c.id));

  async function uploadPhoto(file: File) {
    setUploading(true);
    setUploadErr('');
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `cat-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('menu-photos')
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (upErr) { setUploadErr(`Erro: ${upErr.message}`); setUploading(false); return; }
    setPhotoUrl(supabase.storage.from('menu-photos').getPublicUrl(path).data.publicUrl);
    setUploading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-50 flex items-center justify-center p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSaved({ ...category, name, station, active, photo_url: photoUrl, parent_id: parentId });
        }}
        className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-2xl w-full max-w-md p-5 space-y-4"
      >
        <h2 className="font-bold text-lg text-[#F5A623]">Editar categoria</h2>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Categoria mãe</label>
          <select
            value={parentId ?? ''}
            onChange={(e) => setParentId(e.target.value || null)}
            className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
          >
            <option value="">— Nenhuma (categoria de raiz) —</option>
            {parentOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
          />
        </div>

        {/* Foto circular (para exibição na loja) */}
        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-2">Foto da categoria (círculo na loja)</label>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full overflow-hidden shrink-0 bg-black/30 flex items-center justify-center" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
              {photoUrl
                ? <img src={photoUrl} alt="foto" className="w-full h-full object-cover" />
                : <span className="text-white font-black text-xl">{name[0] ?? '?'}</span>
              }
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#2A1710] bg-[#F5A623] disabled:opacity-50"
              >
                {uploading ? 'A enviar…' : photoUrl ? 'Trocar foto' : 'Adicionar foto'}
              </button>
              {photoUrl && (
                <button type="button" onClick={() => setPhotoUrl(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#A3947F' }}>
                  Remover
                </button>
              )}
            </div>
          </div>
          {uploadErr && <p className="text-xs mt-1 text-[#ef4444]">{uploadErr}</p>}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ''; }} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Estação</label>
          <select
            value={station}
            onChange={(e) => setStation(e.target.value)}
            className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
          >
            {STATIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="categoryActive"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="rounded bg-black/20 border-white/[0.08] text-[#F5A623] focus:ring-[#F5A623]"
          />
          <label htmlFor="categoryActive" className="text-xs font-semibold text-[#C9BCAC]">
            Ativa
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-white/[0.08] text-[#C9BCAC] font-semibold py-3 rounded-xl text-sm hover:bg-white/[0.08] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex-1 bg-[#F5A623] text-[#2A1710] font-bold py-3 rounded-xl text-sm hover:bg-[#D6860F] transition-colors"
          >
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Modal de zona de entrega ─────────────────────────────────────────────────

function ZoneModal({
  zone, onClose, onSaved,
}: {
  zone: Zone | 'new';
  onClose: () => void;
  onSaved: (z: Zone) => void;
}) {
  const isNew = zone === 'new';
  const [name, setName] = useState(isNew ? '' : zone.name);
  const [feeMT, setFeeMT] = useState(isNew ? '' : centsToDecimalString(zone.fee_cents));
  const [active, setActive] = useState(isNew ? true : zone.active);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    
    let feeCents: number;
    try {
      feeCents = decimalStringToCents(feeMT.replace(',', '.'));
    } catch {
      alert('Taxa inválida. Usa o formato 50.00');
      return;
    }

    onSaved({
      id: isNew ? crypto.randomUUID() : zone.id,
      name,
      fee_cents: feeCents,
      active,
      sort: isNew ? 0 : zone.sort,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-50 flex items-center justify-center p-4">
      <form
        onSubmit={handleSave}
        className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-2xl w-full max-w-md p-5 space-y-4"
      >
        <h2 className="font-bold text-lg text-[#F5A623]">
          {isNew ? 'Nova zona' : 'Editar zona'}
        </h2>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Nome da zona</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
            placeholder="ex: Maputo Centro"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#C9BCAC] mb-1">Taxa de entrega (MT)</label>
          <input
            value={feeMT}
            onChange={(e) => setFeeMT(e.target.value)}
            required
            inputMode="decimal"
            className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
            placeholder="ex: 50.00"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="zoneActive"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="rounded bg-black/20 border-white/[0.08] text-[#F5A623] focus:ring-[#F5A623]"
          />
          <label htmlFor="zoneActive" className="text-xs font-semibold text-[#C9BCAC]">
            Ativa
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-white/[0.08] text-[#C9BCAC] font-semibold py-3 rounded-xl text-sm hover:bg-white/[0.08] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex-1 bg-[#F5A623] text-[#2A1710] font-bold py-3 rounded-xl text-sm hover:bg-[#D6860F] transition-colors"
          >
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
