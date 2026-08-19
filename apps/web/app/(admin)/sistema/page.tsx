'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/utils/supabase/client';

type DeviceKind = 'pos' | 'bridge' | 'kds' | 'tv';

type Device = {
  id: string;
  kind: DeviceKind;
  label: string;
  app_version: string | null;
  last_seen_at: string | null;
  online: boolean;
};

type StoreStatus = {
  store_id: string;
  store_slug: string;
  store_name: string;
  accepting_orders: boolean;
  devices: Device[];
  print_queue: { pending: number; failed: number; oldest_pending_at: string | null };
  last_order_at: string | null;
  stock_alerts: number;
  cash_open: boolean;
};

type SystemStatus = {
  checked_at: string;
  silent_after_seconds: number;
  stores: StoreStatus[];
};

type Alert = {
  store_id: string;
  store_name: string;
  kind: 'device_silent' | 'print_failed' | 'order_not_printed' | 'stock' | 'no_sales';
  severity: 'critical' | 'warning';
  message: string;
  details: Record<string, unknown>;
};

const REFRESH_MS = 30_000;

const KIND_LABELS: Record<DeviceKind, string> = {
  pos: 'POS',
  bridge: 'Impressão',
  kds: 'Cozinha',
  tv: 'TV',
};

const ALERT_LABELS: Record<Alert['kind'], string> = {
  device_silent: 'Dispositivo calado',
  print_failed: 'Impressão falhada',
  order_not_printed: 'Pedido sem comanda',
  stock: 'Estoque',
  no_sales: 'Sem vendas',
};

const dateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('pt-PT', {
        timeZone: 'Africa/Maputo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso))
    : '—';

const minutesSince = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 60_000) : null;

export default function SistemaPage() {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [statusResult, alertsResult] = await Promise.all([
      supabase.rpc('get_system_status'),
      supabase.rpc('list_system_alerts'),
    ]);

    if (statusResult.error) {
      setError(`Não foi possível ler o estado do sistema: ${statusResult.error.message}`);
    } else {
      setStatus(statusResult.data as SystemStatus);
      setError(null);
    }
    if (!alertsResult.error && alertsResult.data) setAlerts(alertsResult.data as Alert[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const critical = alerts.filter((alert) => alert.severity === 'critical');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Sistema</h1>
          <p className="text-sm text-[#8b8378]">
            {status ? `Verificado às ${dateTime(status.checked_at)}` : 'A verificar…'} · actualiza a cada 30 s
          </p>
        </div>
        <span
          className={`rounded-full px-4 py-2 text-sm font-black ${
            critical.length > 0 ? 'bg-[#7a2b2b] text-white' : 'bg-[#16281c] text-[#a8e0b6]'
          }`}
        >
          {critical.length > 0 ? `${critical.length} alerta(s) crítico(s)` : 'Tudo operacional'}
        </span>
      </header>

      {error && (
        <p className="rounded-xl border border-[#7a2b2b] bg-[#2a1616] px-4 py-3 text-sm text-[#ffb0b0]">
          {error}
        </p>
      )}

      {loading && !status && (
        <p className="rounded-2xl border border-white/[0.08] p-6 text-center text-sm text-[#8b8378]">
          A ligar aos dispositivos das lojas…
        </p>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        {status?.stores.map((store) => {
          const lastOrderMinutes = minutesSince(store.last_order_at);
          return (
            <article key={store.store_id} className="rounded-2xl border border-white/[0.08] p-5">
              <header className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-black text-white">{store.store_name}</h2>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    store.accepting_orders
                      ? 'bg-[#16281c] text-[#a8e0b6]'
                      : 'bg-[#2a1616] text-[#ffb0b0]'
                  }`}
                >
                  {store.accepting_orders ? 'A aceitar pedidos' : 'Pedidos desligados'}
                </span>
              </header>

              <ul className="mt-4 space-y-2">
                {store.devices.length === 0 && (
                  <li className="text-sm text-[#8b8378]">Nenhum dispositivo registado nesta loja.</li>
                )}
                {store.devices.map((device) => (
                  <li key={device.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          device.online ? 'bg-[#4ade80]' : 'bg-[#ef4444]'
                        }`}
                      />
                      <span className="font-bold text-white">{KIND_LABELS[device.kind]}</span>
                      <span className="text-[#8b8378]">{device.label}</span>
                    </span>
                    <span className="text-xs text-[#8b8378]">
                      {device.online ? 'ligado' : `visto ${dateTime(device.last_seen_at)}`}
                      {device.app_version ? ` · v${device.app_version}` : ''}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-white/[0.03] p-3">
                  <dt className="text-xs uppercase text-[#8b8378]">Fila de impressão</dt>
                  <dd className="mt-1 font-black text-white">
                    {store.print_queue.pending} por imprimir
                    {store.print_queue.failed > 0 && (
                      <span className="ml-2 text-[#ff9b9b]">{store.print_queue.failed} falhados</span>
                    )}
                  </dd>
                </div>
                <div className="rounded-xl bg-white/[0.03] p-3">
                  <dt className="text-xs uppercase text-[#8b8378]">Último pedido</dt>
                  <dd className="mt-1 font-black text-white">
                    {lastOrderMinutes === null
                      ? '—'
                      : lastOrderMinutes < 60
                        ? `há ${lastOrderMinutes} min`
                        : dateTime(store.last_order_at)}
                  </dd>
                </div>
                <div className="rounded-xl bg-white/[0.03] p-3">
                  <dt className="text-xs uppercase text-[#8b8378]">Caixa</dt>
                  <dd className="mt-1 font-black text-white">
                    {store.cash_open ? 'Aberta' : 'Fechada'}
                  </dd>
                </div>
                <div className="rounded-xl bg-white/[0.03] p-3">
                  <dt className="text-xs uppercase text-[#8b8378]">Estoque em alerta</dt>
                  <dd className="mt-1 font-black text-white">{store.stock_alerts}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </section>

      <section className="rounded-2xl border border-white/[0.08]">
        <header className="border-b border-white/[0.06] px-4 py-3">
          <h2 className="font-black text-white">Alertas</h2>
        </header>
        <ul className="divide-y divide-white/[0.06]">
          {alerts.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-[#8b8378]">
              Sem alertas abertos nas tuas lojas.
            </li>
          )}
          {alerts.map((alert, index) => (
            <li key={`${alert.store_id}-${alert.kind}-${index}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span
                className={`rounded-full px-2 py-1 text-xs font-bold ${
                  alert.severity === 'critical'
                    ? 'bg-[#7a2b2b] text-white'
                    : 'bg-[#e5a93c]/20 text-[#e5a93c]'
                }`}
              >
                {ALERT_LABELS[alert.kind]}
              </span>
              <span className="font-bold text-white">{alert.store_name}</span>
              <span className="flex-1 text-[#C9BCAC]">{alert.message}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
