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
  /** Foto própria da variante (Coca Zero ≠ Coca). Null = usa a do produto. */
  photo_url: string | null;
}

interface Addon {
  id: string;
  menu_item_id: string;
  name: string;
  price_cents: number;
  sort: number;
  active: boolean;
  photo_url: string | null;
}

/**
 * Fotos genéricas de ingredientes para os extras do balcão (1078). São do
 * produto, não de um cliente: qual vai para qual extra decide-o a loja aqui.
 */
const EXTRA_PHOTOS = [
  { label: 'Queijo', url: '/assets/storefront/extras/queijo.webp', match: /queijo|cheese|cheddar/i },
  { label: 'Bacon / Macon', url: '/assets/storefront/extras/bacon.webp', match: /bacon|macon/i },
  { label: 'Carne', url: '/assets/storefront/extras/carne.webp', match: /carne|burger|hamb|patty|smash/i },
  { label: 'Jalapeño', url: '/assets/storefront/extras/jalapeno.webp', match: /jalape|pimenta|chili/i },
  { label: 'Picles', url: '/assets/storefront/extras/picles.webp', match: /picle|pickle/i },
] as const;

/** A foto que o nome do extra sugere ("Queijo extra" → queijo). Null = nenhuma. */
function suggestExtraPhoto(name: string): string | null {
  return EXTRA_PHOTOS.find((foto) => foto.match.test(name))?.url ?? null;
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
  const photoInputRef = useRef<HTMLInputElement>(null);
  // A foto escolhida aparece logo, antes de guardar; sem escolha, a que já lá está.
  const [filePreview, setFilePreview] = useState<string | null>(null);
  useEffect(() => {
    if (!photoFile) { setFilePreview(null); return; }
    const url = URL.createObjectURL(photoFile);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);
  const photoPreview = filePreview ?? item?.photo_url ?? null;
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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <form
        onSubmit={handleSave}
        className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/[0.08] bg-[#14110F] shadow-[0_24px_80px_rgba(0,0,0,0.6)] sm:rounded-3xl"
      >
        {/* Cabeçalho fixo */}
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8b8378]">
              {item ? 'Editar produto' : 'Novo produto'}
            </p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-white">{name.trim() || 'Sem nome'}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-[#C9BCAC] transition-colors hover:bg-white/[0.12] hover:text-white"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Foto + nome + preço */}
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="group relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-dashed border-white/[0.14] bg-white/[0.03] transition-colors hover:border-[#F5A623]"
              aria-label={photoPreview ? 'Trocar foto' : 'Adicionar foto'}
            >
              {photoPreview ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoPreview} alt="" className="h-full w-full object-contain p-1.5" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Trocar foto
                  </span>
                </>
              ) : (
                <span className="flex h-full flex-col items-center justify-center gap-1 text-[#8b8378]">
                  <span className="text-2xl leading-none">＋</span>
                  <span className="text-[11px] font-semibold">Foto</span>
                </span>
              )}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => { setPhotoFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />

            <div className="min-w-0 flex-1 space-y-3">
              <Field label="Nome">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className={INPUT}
                  placeholder="ex: Frango grelhado"
                />
              </Field>
              <Field label="Preço">
                <div className="relative">
                  <input
                    value={priceMT}
                    onChange={(e) => setPriceMT(e.target.value)}
                    required
                    inputMode="decimal"
                    className={`${INPUT} pr-12 font-semibold text-[#F5A623]`}
                    placeholder="250.00"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#8b8378]">MT</span>
                </div>
              </Field>
            </div>
          </div>

          <Field label="Descrição">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={`${INPUT} resize-none`}
              placeholder="ex: Com batata frita e salada"
            />
          </Field>

          {/* Onde aparece */}
          <Section title="Onde aparece">
            <div className="grid grid-cols-2 gap-2">
              <ChannelChip label="Delivery" hint="Site e levantamento" on={availableDelivery} onToggle={() => setAvailableDelivery((v) => !v)} />
              <ChannelChip label="QR Mesa" hint="Pedido na mesa" on={availableDineIn} onToggle={() => setAvailableDineIn((v) => !v)} />
            </div>
          </Section>

          {/* Opções */}
          <Section title="Opções">
            <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
              <SwitchRow
                label="Oferecer no fim do pedido"
                hint="Aparece entre o carrinho e o pagamento (bebidas, batatas, sobremesas)."
                on={isUpsell}
                onToggle={() => setIsUpsell((v) => !v)}
              />
              <SwitchRow
                label="Controlar estoque"
                hint="Esgota sozinho quando chega a zero."
                on={trackStock}
                onToggle={() => setTrackStock((v) => !v)}
              >
                {trackStock && (
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-xs text-[#C9BCAC]">Quantidade</span>
                    <input
                      type="number"
                      min="0"
                      value={stockQty}
                      onChange={(e) => setStockQty(parseInt(e.target.value) || 0)}
                      className={`${INPUT} w-28`}
                    />
                  </div>
                )}
              </SwitchRow>
            </div>
          </Section>

          {/* Variantes + Adicionais (opcional). Só para item já guardado, pois
              referenciam menu_item_id. Sem nenhum → item fica "simples". */}
          {item ? (
            <OptionsEditor itemId={item.id} />
          ) : (
            <p className="rounded-2xl border border-dashed border-white/[0.1] px-4 py-3 text-xs text-[#C9BCAC]">
              Guarda o produto primeiro para adicionar <strong className="text-white">variantes</strong> e{' '}
              <strong className="text-white">adicionais</strong>.
            </p>
          )}

          {error && (
            <p className="rounded-xl border border-red-800/70 bg-red-900/20 px-3 py-2 text-sm text-red-300">{error}</p>
          )}
        </div>

        {/* Rodapé fixo */}
        <footer className="flex gap-2 border-t border-white/[0.06] bg-[#14110F] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/[0.08] py-3 text-sm font-semibold text-[#C9BCAC] transition-colors hover:bg-white/[0.06]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-[2] rounded-xl bg-[#F5A623] py-3 text-sm font-bold text-[#2A1710] shadow-[0_8px_24px_rgba(245,166,35,0.25)] transition-colors hover:bg-[#D6860F] disabled:opacity-60"
          >
            {saving ? 'A guardar…' : 'Guardar'}
          </button>
        </footer>
      </form>
    </div>
  );
}

const INPUT =
  'w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder-[#6f675d] transition-colors focus:border-[#F5A623] focus:bg-white/[0.06] focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[#C9BCAC]">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8b8378]">{title}</h3>
        {hint && <span className="text-[11px] text-[#6f675d]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-[#F5A623]' : 'bg-white/[0.12]'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </span>
  );
}

function SwitchRow({
  label, hint, on, onToggle, children,
}: { label: string; hint: string; on: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{label}</span>
          <span className="mt-0.5 block text-xs text-[#8b8378]">{hint}</span>
        </span>
        <Switch on={on} />
      </button>
      {children}
    </div>
  );
}

function ChannelChip({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
        on ? 'border-[#F5A623]/60 bg-[#F5A623]/10' : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
          on ? 'bg-[#F5A623] text-[#2A1710]' : 'border border-white/[0.2] text-transparent'
        }`}
      >
        ✓
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${on ? 'text-white' : 'text-[#C9BCAC]'}`}>{label}</span>
        <span className="block text-[11px] text-[#8b8378]">{hint}</span>
      </span>
    </button>
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
        .select('id, menu_item_id, name, price_cents, sort, is_default, active, photo_url')
        .eq('menu_item_id', itemId).order('sort'),
      supabase.from('menu_addons')
        .select('id, menu_item_id, name, price_cents, sort, active, photo_url')
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

  // Mudar o preço sem apagar: apagar o tamanho leva a ficha técnica em cascata.
  async function setVariantPrice(id: string, priceCents: number) {
    setErr('');
    const { error } = await supabase.from('menu_item_variants').update({ price_cents: priceCents }).eq('id', id);
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  /**
   * A foto da variante vai para o mesmo bucket das do produto. É ela que o
   * site, o upsell e o POS mostram quando a variante está escolhida; sem foto,
   * fica a do produto.
   */
  async function uploadVariantPhoto(id: string, file: File) {
    setErr('');
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('menu-photos')
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (upErr) { setErr(`Erro no upload da foto: ${upErr.message}`); return; }
    await setVariantPhoto(id, supabase.storage.from('menu-photos').getPublicUrl(path).data.publicUrl);
  }

  async function setVariantPhoto(id: string, photoUrl: string | null) {
    setErr('');
    const { error } = await supabase.from('menu_item_variants').update({ photo_url: photoUrl }).eq('id', id);
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  async function deleteVariant(id: string) {
    setErr('');
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
      photo_url: suggestExtraPhoto(name),
    });
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  async function setAddonPhoto(id: string, photoUrl: string | null) {
    setErr('');
    const { error } = await supabase.from('menu_addons').update({ photo_url: photoUrl }).eq('id', id);
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  async function deleteAddon(id: string) {
    const { error } = await supabase.from('menu_addons').delete().eq('id', id);
    if (error) { setErr(`Erro: ${error.message}`); return; }
    refetch();
  }

  const [copyInfo, setCopyInfo] = useState('');

  /**
   * Os extras do balcão (queijo, bacon…) são os mesmos em todos os lanches,
   * mas vivem em cada produto. Isto copia os deste para os outros da mesma
   * categoria, sem duplicar um que já lá esteja com o mesmo nome e sem mexer
   * nos preços dos que já existem.
   */
  async function copyAddonsToCategory() {
    setErr(''); setCopyInfo('');
    const ativos = addons.filter((a) => a.active);
    if (ativos.length === 0) return;
    const { data: self, error: selfError } = await supabase
      .from('menu_items').select('category_id').eq('id', itemId).single();
    if (selfError || !self) { setErr(`Erro: ${selfError?.message ?? 'produto não encontrado'}`); return; }
    const { data: irmaos, error: irmaosError } = await supabase
      .from('menu_items').select('id').eq('category_id', self.category_id).neq('id', itemId);
    if (irmaosError) { setErr(`Erro: ${irmaosError.message}`); return; }
    const ids = (irmaos ?? []).map((i) => i.id as string);
    if (ids.length === 0) { setCopyInfo('Não há outros produtos nesta categoria.'); return; }
    if (!confirm(`Copiar ${ativos.length} adicionais para ${ids.length} produtos desta categoria?`)) return;
    const { data: existentes, error: existentesError } = await supabase
      .from('menu_addons').select('menu_item_id, name').in('menu_item_id', ids);
    if (existentesError) { setErr(`Erro: ${existentesError.message}`); return; }
    const chave = (menuItemId: string, name: string) => `${menuItemId}|${name.trim().toLocaleLowerCase('pt-PT')}`;
    const ja = new Set((existentes ?? []).map((e) => chave(e.menu_item_id as string, e.name as string)));
    const novos = ids.flatMap((id) =>
      ativos
        .filter((a) => !ja.has(chave(id, a.name)))
        .map((a) => ({
          menu_item_id: id, name: a.name, price_cents: a.price_cents, sort: a.sort, active: true, photo_url: a.photo_url,
        })),
    );
    if (novos.length > 0) {
      const { error } = await supabase.from('menu_addons').insert(novos);
      if (error) { setErr(`Erro: ${error.message}`); return; }
    }
    setCopyInfo(
      novos.length > 0
        ? `${novos.length} adicionais copiados. Os que já existiam ficaram como estavam.`
        : 'Os outros produtos já tinham estes adicionais.',
    );
  }

  return (
    <div className="space-y-5">
      {err && <p className="rounded-xl border border-red-800/70 bg-red-900/20 px-3 py-2 text-sm text-red-300">{err}</p>}

      {/* Variantes (tamanhos, sabores…) */}
      <Section title="Variantes" hint="escolha única · substitui o preço">
        <ul className="space-y-2">
          {variants.map((v) => (
            <li
              key={v.id}
              className={`flex items-center gap-3 rounded-2xl border p-2.5 pr-3 transition-colors ${
                v.is_default ? 'border-[#F5A623]/50 bg-[#F5A623]/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'
              }`}
            >
              <VariantPhoto
                name={v.name}
                photoUrl={v.photo_url}
                onUpload={(file) => uploadVariantPhoto(v.id, file)}
                onRemove={() => setVariantPhoto(v.id, null)}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{v.name}</p>
                <button
                  type="button"
                  onClick={() => setDefaultVariant(v.id)}
                  disabled={v.is_default}
                  className={`mt-0.5 text-[11px] font-semibold ${
                    v.is_default ? 'text-[#F5A623]' : 'text-[#8b8378] hover:text-[#C9BCAC]'
                  }`}
                >
                  {v.is_default ? '★ Padrão' : 'Tornar padrão'}
                </button>
              </div>
              <PriceEdit cents={v.price_cents} label={`Preço de ${v.name}`} onSave={(c) => setVariantPrice(v.id, c)} />
              <RemoveButton label={`Apagar ${v.name}`} onClick={() => deleteVariant(v.id)} />
            </li>
          ))}
          {variants.length === 0 && (
            <li className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-3 text-xs text-[#8b8378]">
              Sem variantes — produto de preço único.
            </li>
          )}
        </ul>
        <div className="mt-2">
          <OptionAddRow placeholder="Nova variante (ex: Zero, Médio)" onAdd={addVariant} />
        </div>
        {variants.length > 0 && (
          <p className="mt-2 text-[11px] text-[#6f675d]">
            Toca na miniatura para dar foto própria à variante. Sem foto, usa a do produto.
          </p>
        )}
      </Section>

      {/* Adicionais */}
      <Section title="Adicionais" hint="vários · somam ao preço">
        <ul className="space-y-2">
          {addons.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2.5 pr-3">
              {/* A foto do botão no POS (1078). */}
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.05]">
                {a.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.photo_url} alt="" className="h-full w-full object-contain p-1" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{a.name}</p>
                <select
                  value={a.photo_url ?? ''}
                  onChange={(e) => setAddonPhoto(a.id, e.target.value || null)}
                  aria-label={`Foto de ${a.name}`}
                  className="mt-0.5 max-w-full rounded-md bg-transparent text-[11px] font-semibold text-[#8b8378] hover:text-[#C9BCAC] focus:outline-none"
                >
                  <option value="">Sem foto</option>
                  {EXTRA_PHOTOS.map((foto) => (
                    <option key={foto.url} value={foto.url}>{foto.label}</option>
                  ))}
                  {a.photo_url && !EXTRA_PHOTOS.some((foto) => foto.url === a.photo_url) && (
                    <option value={a.photo_url}>Outra</option>
                  )}
                </select>
              </div>
              <span className="text-sm font-semibold text-[#F5A623]">+{formatMT(a.price_cents)}</span>
              <RemoveButton label={`Apagar ${a.name}`} onClick={() => deleteAddon(a.id)} />
            </li>
          ))}
          {addons.length === 0 && (
            <li className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-3 text-xs text-[#8b8378]">
              Sem adicionais.
            </li>
          )}
        </ul>
        <div className="mt-2">
          <OptionAddRow placeholder="Novo adicional (ex: Queijo extra)" onAdd={addAddon} />
        </div>
        <p className="mt-2 text-[11px] text-[#6f675d]">
          No balcão, são estes os extras que o POS oferece para este produto — e saem grandes na comanda.
        </p>
        {addons.length > 0 && (
          <button
            type="button"
            onClick={copyAddonsToCategory}
            className="mt-2 text-xs font-semibold text-[#F5A623] hover:underline"
          >
            Copiar estes adicionais para os outros produtos da categoria
          </button>
        )}
        {copyInfo && <p className="mt-1 text-xs text-emerald-400">{copyInfo}</p>}
      </Section>
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm text-[#8b8378] transition-colors hover:bg-red-500/10 hover:text-red-400"
    >
      ✕
    </button>
  );
}

/** Miniatura da variante: toca para escolher ou trocar a foto; ✕ tira-a. */
function VariantPhoto({
  name, photoUrl, onUpload, onRemove,
}: {
  name: string;
  photoUrl: string | null;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function pick(file: File) {
    setUploading(true);
    try { await onUpload(file); } finally { setUploading(false); }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        title={photoUrl ? `Trocar foto de ${name}` : `Adicionar foto a ${name}`}
        aria-label={photoUrl ? `Trocar foto de ${name}` : `Adicionar foto a ${name}`}
        className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl text-[10px] font-semibold text-[#8b8378] transition-colors hover:ring-1 hover:ring-[#F5A623] disabled:opacity-60 ${
          photoUrl ? 'bg-white/[0.05]' : 'border border-dashed border-white/[0.16] bg-transparent'
        }`}
      >
        {uploading ? '…' : photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-full w-full object-contain p-1" />
        ) : (
          <span className="flex flex-col items-center leading-tight"><span className="text-base">＋</span>foto</span>
        )}
      </button>
      {photoUrl && !uploading && (
        <button
          type="button"
          onClick={onRemove}
          title={`Tirar foto de ${name}`}
          aria-label={`Tirar foto de ${name}`}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#2A1710] text-[9px] text-red-400 ring-1 ring-white/[0.15] hover:bg-red-500 hover:text-white"
        >
          ✕
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }}
      />
    </div>
  );
}

/** Preço clicável: toca para editar, Enter ou sair do campo grava. */
function PriceEdit({ cents, label, onSave }: { cents: number; label: string; onSave: (cents: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  function start() {
    setValue(String(cents / 100));
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    let next: number;
    try {
      next = decimalStringToCents(value.replace(',', '.'));
    } catch {
      return;
    }
    if (next !== cents) onSave(next);
  }

  if (!editing) {
    return (
      <button type="button" onClick={start} title="Editar preço" aria-label={label}
        className="rounded-lg px-2 py-1 text-sm font-semibold text-[#F5A623] transition-colors hover:bg-[#F5A623]/10">
        {formatMT(cents)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') setEditing(false);
      }}
      inputMode="decimal"
      aria-label={label}
      className="w-20 rounded-lg border border-[#F5A623] bg-white/[0.04] px-2 py-1 text-sm text-white focus:outline-none"
    />
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

  // Enter acrescenta a linha em vez de submeter o formulário do produto inteiro.
  function onEnter(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  }

  return (
    <div className="flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onEnter}
        placeholder={placeholder}
        className={`${INPUT} flex-1`}
      />
      <div className="relative w-24">
        <input
          value={priceMT}
          onChange={(e) => setPriceMT(e.target.value)}
          onKeyDown={onEnter}
          inputMode="decimal"
          placeholder="0"
          className={`${INPUT} pr-9`}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#6f675d]">MT</span>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={!name.trim()}
        aria-label="Acrescentar"
        className="flex w-11 shrink-0 items-center justify-center rounded-xl bg-[#F5A623] text-lg font-bold text-[#2A1710] transition-colors hover:bg-[#D6860F] disabled:bg-white/[0.08] disabled:text-[#6f675d]"
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
