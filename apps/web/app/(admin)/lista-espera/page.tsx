'use client';

/**
 * Clientes — todos os que já se identificaram numa compra (nome + telefone),
 * vindos de `customers` (CLAUDE §15/loja §9). Substitui o antigo ecrã de
 * "lista de espera", que era uma fila de interesse manual que ninguém usava —
 * o que a equipa quer ver aqui é quem já comprou, quanto gastou e quando.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { createClient } from '@/utils/supabase/client';

type Customer = {
  phone: string;
  name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  orders_count: number;
  total_spent_cents: number;
};

type Address = {
  id: string;
  label: string;
  address: string;
  notes: string;
  is_default: boolean;
};

type RecentOrder = {
  id: string;
  order_number: string;
  status: string;
  fulfillment_type: string;
  total_cents: number;
  created_at: string;
  items: { menu_item_id: string | null; name: string; qty: number }[];
};

type SortKey = 'last_seen_at' | 'total_spent_cents' | 'orders_count' | 'name';

const PAGE_SIZE = 24;

const sortOptions: [SortKey, string][] = [
  ['last_seen_at', 'Mais recentes'],
  ['total_spent_cents', 'Quem mais gasta'],
  ['orders_count', 'Quem mais pede'],
  ['name', 'Nome A–Z'],
];

const statusLabels: Record<string, string> = {
  draft: 'Rascunho',
  awaiting_approval: 'A aguardar aprovação',
  awaiting_payment: 'A aguardar pagamento',
  approved: 'Aprovado',
  paid: 'Pago',
  in_preparation: 'Em preparo',
  ready: 'Pronto',
  delivered: 'Entregue',
  cancelled: 'Anulado',
};

const fulfillmentLabels: Record<string, string> = {
  delivery: 'Entrega',
  pickup: 'Levantamento',
  counter: 'Balcão',
  dine_in: 'Sentado',
};

const formatPhone = (phone: string) => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5)}`;
  }
  return phone;
};

const mt = (value: number) => formatMT(value as Cents);

const dateLong = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const dateShort = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });

export default function ClientesPage() {
  const supabase = useMemo(() => createClient(), []);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('last_seen_at');
  const [page, setPage] = useState(0);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);

    let query = supabase.from('customers').select('*', { count: 'exact' });

    const term = search.trim().replace(/[,()%]/g, '');
    if (term) {
      const digits = term.replace(/\D/g, '');
      query = query.or(
        `name.ilike.%${term}%${digits ? `,phone.ilike.%${digits}%` : ''}`,
      );
    }

    query = query
      .order(sortKey, { ascending: sortKey === 'name' })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    const { data, error: err, count } = await query;

    if (err) {
      setError(err.message);
    } else {
      setCustomers((data ?? []) as Customer[]);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [page, search, sortKey, supabase]);

  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  async function toggleDetails(phone: string) {
    if (expanded === phone) {
      setExpanded(null);
      return;
    }
    setExpanded(phone);
    setDetailLoading(true);
    const [addressList, orderList] = await Promise.all([
      supabase
        .from('customer_addresses')
        .select('id,label,address,notes,is_default')
        .eq('customer_phone', phone)
        .order('is_default', { ascending: false }),
      supabase.rpc('get_customer_orders', { p_phone: phone }),
    ]);
    setAddresses((addressList.data ?? []) as Address[]);
    setOrders(((orderList.data as { orders: RecentOrder[] } | null)?.orders ?? []).slice(0, 8));
    setDetailLoading(false);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Clientes</h1>
          <p className="text-sm text-[#C9BCAC]">
            {total} {total === 1 ? 'cliente já identificado' : 'clientes já identificados'} numa compra
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => {
            setPage(0);
            setSearch(event.target.value);
          }}
          placeholder="Procurar por nome ou telefone"
          className="min-w-56 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white placeholder:text-[#6f6a62]"
        />
        <div className="flex flex-wrap gap-2">
          {sortOptions.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setPage(0);
                setSortKey(key);
              }}
              className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                sortKey === key
                  ? 'border-[#F5A623] bg-[#F5A623]/15 text-[#F5A623]'
                  : 'border-white/10 text-[#C9BCAC] hover:bg-white/[0.05]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-[#7a2b2b] bg-[#2a1616] p-6 text-center text-[#ffb0b0]">
          Erro: {error}
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] p-10 text-center text-[#F5A623]">
          A carregar clientes…
        </div>
      )}

      {!loading && !error && customers.length === 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] p-10 text-center text-[#C9BCAC]">
          {search
            ? 'Nenhum cliente corresponde a esta procura.'
            : 'Ainda não há clientes registados — aparecem aqui assim que fizerem a primeira compra.'}
        </div>
      )}

      {!loading && customers.length > 0 && (
        <div className="space-y-3">
          {customers.map((customer) => {
            const isOpen = expanded === customer.phone;
            return (
              <div
                key={customer.phone}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => void toggleDetails(customer.phone)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-6 py-4 text-left hover:bg-white/[0.03]"
                >
                  <div>
                    <div className="font-semibold text-[#F3E4CE]">
                      {customer.name || 'Sem nome'}
                    </div>
                    <div className="text-sm text-[#F5A623]">{formatPhone(customer.phone)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="text-[#C9BCAC] text-xs">Pedidos</div>
                      <div className="font-bold text-[#F3E4CE]">{customer.orders_count}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#C9BCAC] text-xs">Total gasto</div>
                      <div className="font-bold text-[#F5A623]">{mt(customer.total_spent_cents)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#C9BCAC] text-xs">Última visita</div>
                      <div className="text-[#F3E4CE]">{dateShort(customer.last_seen_at)}</div>
                    </div>
                    <div className="text-center hidden sm:block">
                      <div className="text-[#C9BCAC] text-xs">Cliente desde</div>
                      <div className="text-[#F3E4CE]">{dateShort(customer.first_seen_at)}</div>
                    </div>
                    <span className="text-[#8b8378]">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-white/[0.06] px-6 py-4 space-y-4">
                    {detailLoading ? (
                      <p className="text-sm text-[#8b8378]">A carregar…</p>
                    ) : (
                      <>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wide text-[#8b8378] mb-2">
                            Moradas guardadas
                          </h3>
                          {addresses.length === 0 ? (
                            <p className="text-sm text-[#8b8378]">Sem moradas guardadas.</p>
                          ) : (
                            <ul className="flex flex-wrap gap-2">
                              {addresses.map((address) => (
                                <li
                                  key={address.id}
                                  className="rounded-xl bg-white/[0.06] px-3 py-2 text-xs text-[#C9BCAC]"
                                >
                                  <span className="font-bold text-white">{address.label}</span>
                                  {address.is_default && (
                                    <span className="ml-1 text-[#F5A623]">· principal</span>
                                  )}
                                  <div>{address.address}</div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wide text-[#8b8378] mb-2">
                            Últimos pedidos
                          </h3>
                          {orders.length === 0 ? (
                            <p className="text-sm text-[#8b8378]">Sem pedidos ainda.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-white/[0.08] text-xs text-[#8b8378]">
                                    <th className="text-left py-1 pr-3">Pedido</th>
                                    <th className="text-left py-1 pr-3">Estado</th>
                                    <th className="text-left py-1 pr-3">Canal</th>
                                    <th className="text-left py-1 pr-3">Itens</th>
                                    <th className="text-right py-1 pr-3">Total</th>
                                    <th className="text-right py-1">Data</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {orders.map((order) => (
                                    <tr key={order.id} className="border-b border-white/[0.04]">
                                      <td className="py-2 pr-3 text-[#F3E4CE]">{order.order_number}</td>
                                      <td className="py-2 pr-3 text-[#C9BCAC]">
                                        {statusLabels[order.status] ?? order.status}
                                      </td>
                                      <td className="py-2 pr-3 text-[#C9BCAC]">
                                        {fulfillmentLabels[order.fulfillment_type] ?? order.fulfillment_type}
                                      </td>
                                      <td className="py-2 pr-3 text-[#8b8378]">
                                        {order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}
                                      </td>
                                      <td className="py-2 pr-3 text-right font-bold text-[#F5A623]">
                                        {mt(order.total_cents)}
                                      </td>
                                      <td className="py-2 text-right text-xs text-[#8b8378]">
                                        {dateLong(order.created_at)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 bg-white/[0.08] rounded text-[#F3E4CE] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/[0.12] transition-colors"
          >
            Anterior
          </button>
          <span className="text-[#C9BCAC]">
            Página {page + 1} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-4 py-2 bg-white/[0.08] rounded text-[#F3E4CE] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/[0.12] transition-colors"
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
