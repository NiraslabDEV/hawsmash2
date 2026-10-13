'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { useScreenWakeLock } from '@/app/(pos)/pos/use-screen-wake-lock';
import { navigationUrl, phoneHref, type CourierAction, type CourierJob, type CourierState } from '@/lib/estafeta/contract';
import { shouldSendPing, type Fix } from '@/lib/estafeta/tracking';

const money = (c: number) => formatMT(c as Cents);

class SemSessao extends Error {}

async function lerEstado(): Promise<CourierState> {
  const res = await fetch('/api/estafeta', { cache: 'no-store' });
  if (res.status === 401) throw new SemSessao();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Sem ligação.');
  return body as CourierState;
}

async function enviar(action: CourierAction): Promise<{ ok: boolean; error?: string; status: number }> {
  try {
    const res = await fetch('/api/estafeta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, error: body.error, status: res.status };
  } catch {
    return { ok: false, error: 'Sem rede. Tenta outra vez — não fica nada em dobro.', status: 0 };
  }
}

export default function EstafetaPage() {
  const queryClient = useQueryClient();
  const estado = useQuery({
    queryKey: ['estafeta'],
    queryFn: lerEstado,
    // Entregas novas aparecem sozinhas; o ecrã está aceso durante o serviço.
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    retry: (n, err) => !(err instanceof SemSessao) && n < 2,
  });

  if (estado.error instanceof SemSessao) {
    return <Entrar onEntrou={() => void queryClient.invalidateQueries({ queryKey: ['estafeta'] })} />;
  }
  if (!estado.data) {
    return (
      <main className="grid min-h-[100dvh] place-items-center p-6 text-center text-[var(--ink-dim)]">
        {estado.error ? (
          <div className="space-y-3">
            <p>{(estado.error as Error).message}</p>
            <button className="rounded-xl bg-[var(--gold)] px-5 py-3 font-semibold text-black" onClick={() => void estado.refetch()}>
              Tentar outra vez
            </button>
          </div>
        ) : (
          'A carregar…'
        )}
      </main>
    );
  }
  return <Painel estado={estado.data} recarregar={() => void estado.refetch()} />;
}

// ─── Entrar ───────────────────────────────────────────────────────────────────
function Entrar({ onEntrou }: { onEntrou: () => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aEntrar, setAEntrar] = useState(false);

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setAEntrar(true);
    try {
      const res = await fetch('/api/estafeta/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(body.error ?? 'Não foi possível entrar.');
        setPin('');
        return;
      }
      onEntrou();
    } catch {
      setErro('Sem rede. Tenta outra vez.');
    } finally {
      setAEntrar(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-wide text-[var(--gold)]">Estafeta</h1>
        <p className="mt-1 text-sm text-[var(--ink-dim)]">Entra com o teu telefone e o PIN que a loja te deu.</p>
      </div>
      <form onSubmit={submeter} className="space-y-4">
        <label className="block">
          <span className="text-sm text-[var(--ink-dim)]">Telefone</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="84 123 4567"
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-lg outline-none focus:border-[var(--gold)]"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-[var(--ink-dim)]">PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            pattern="[0-9]{4,6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-lg tracking-[0.4em] outline-none focus:border-[var(--gold)]"
            required
          />
        </label>
        {erro && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{erro}</p>}
        <button
          type="submit"
          disabled={aEntrar}
          className="w-full rounded-xl bg-[var(--gold)] py-4 text-lg font-semibold text-black disabled:opacity-60"
        >
          {aEntrar ? 'A entrar…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

// ─── Localização ──────────────────────────────────────────────────────────────
type Gps = 'off' | 'a-pedir' | 'ligado' | 'negado' | 'sem-suporte';

/**
 * Enquanto está de serviço, manda a posição — só com a página aberta e o ecrã
 * aceso: é o limite de uma app web. Sem permissão o resto funciona igual.
 */
function useLocalizacao(ativo: boolean): Gps {
  const [gps, setGps] = useState<Gps>('off');
  const ultimo = useRef<Fix | null>(null);

  useEffect(() => {
    if (!ativo) {
      setGps('off');
      ultimo.current = null;
      return;
    }
    if (!('geolocation' in navigator)) {
      setGps('sem-suporte');
      return;
    }
    setGps('a-pedir');
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGps('ligado');
        const fix: Fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
        if (!shouldSendPing(ultimo.current, fix)) return;
        ultimo.current = fix;
        void enviar({ action: 'ping', lat: fix.lat, lng: fix.lng, accuracy: pos.coords.accuracy });
      },
      (err) => setGps(err.code === err.PERMISSION_DENIED ? 'negado' : 'a-pedir'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [ativo]);

  return gps;
}

/** Posição actual, uma vez, para marcar onde foi entregue. Nunca bloqueia: 4 s e segue. */
function posicaoAgora(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const desiste = setTimeout(() => resolve(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(desiste);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        clearTimeout(desiste);
        resolve(null);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 4000 },
    );
  });
}

const GPS_TEXTO: Record<Gps, string> = {
  off: '',
  'a-pedir': 'A procurar a tua localização…',
  ligado: 'Localização partilhada com a loja.',
  negado: 'Localização bloqueada. A loja não te vê no mapa — liga-a nas definições do browser.',
  'sem-suporte': 'Este telemóvel não partilha localização.',
};

// ─── Painel ───────────────────────────────────────────────────────────────────
function Painel({ estado, recarregar }: { estado: CourierState; recarregar: () => void }) {
  const queryClient = useQueryClient();
  const deServico = estado.courier.on_shift;
  const gps = useLocalizacao(deServico);
  useScreenWakeLock(deServico);
  const [erro, setErro] = useState<string | null>(null);
  const [aMudar, setAMudar] = useState(false);

  // Entrega nova: vibra, para quem tem o telemóvel no suporte da mota.
  const contagem = useRef(estado.jobs.length);
  useEffect(() => {
    if (estado.jobs.length > contagem.current && 'vibrate' in navigator) navigator.vibrate([300, 150, 300]);
    contagem.current = estado.jobs.length;
  }, [estado.jobs.length]);

  const agir = async (action: CourierAction) => {
    setErro(null);
    const r = await enviar(action);
    if (r.status === 401) {
      await queryClient.invalidateQueries({ queryKey: ['estafeta'] });
      return false;
    }
    if (!r.ok) setErro(r.error ?? 'Não foi possível.');
    recarregar();
    return r.ok;
  };

  const mudarServico = async () => {
    setAMudar(true);
    await agir({ action: 'shift', on: !deServico });
    setAMudar(false);
  };

  const sair = async () => {
    await enviar({ action: 'logout' });
    await queryClient.invalidateQueries({ queryKey: ['estafeta'] });
  };

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 pb-10 pt-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{estado.courier.full_name}</p>
          <p className="truncate text-xs text-[var(--ink-dim)]">{estado.store?.name}</p>
        </div>
        <button onClick={sair} className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm text-[var(--ink-dim)]">
          Sair
        </button>
      </header>

      <button
        onClick={mudarServico}
        disabled={aMudar}
        className={`w-full rounded-2xl py-5 text-lg font-bold transition-colors disabled:opacity-60 ${
          deServico ? 'bg-emerald-500 text-black' : 'border-2 border-dashed border-white/20 text-[var(--ink-dim)]'
        }`}
      >
        {deServico ? '● De serviço — tocar para sair' : 'Começar serviço'}
      </button>
      {deServico && gps !== 'off' && (
        <p className={`text-center text-xs ${gps === 'negado' || gps === 'sem-suporte' ? 'text-amber-300' : 'text-[var(--ink-dim)]'}`}>
          {GPS_TEXTO[gps]}
        </p>
      )}

      {erro && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{erro}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-dim)]">
          Entregas {estado.jobs.length > 0 && <span className="text-[var(--gold)]">({estado.jobs.length})</span>}
        </h2>
        {estado.jobs.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-[var(--ink-dim)]">
            {deServico ? 'Sem entregas. Quando a loja te atribuir uma, aparece aqui.' : 'Começa o serviço para receberes entregas.'}
          </p>
        ) : (
          estado.jobs.map((job) => <Entrega key={job.delivery_id} job={job} agir={agir} />)
        )}
      </section>

      <section className="grid grid-cols-3 gap-2 text-center">
        <Numero titulo="Hoje" valor={String(estado.today.deliveries)} sub="entregas" />
        <Numero titulo="Ganho hoje" valor={money(estado.today.earned_cents)} />
        <Numero titulo="A receber" valor={money(estado.balance_cents)} destaque />
      </section>

      {estado.ledger.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-dim)]">Movimentos</h2>
          <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.03]">
            {estado.ledger.map((l, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  {l.kind === 'delivery_fee' ? `Entrega ${l.order_number ?? ''}` : l.kind === 'payout' ? 'Pagamento recebido' : 'Acerto'}
                  <span className="block text-xs text-[var(--ink-mute)]">
                    {new Date(l.created_at).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <span className={l.amount_cents < 0 ? 'text-[var(--ink-dim)]' : 'text-emerald-400'}>
                  {l.amount_cents > 0 ? '+' : '−'}
                  {money(Math.abs(l.amount_cents))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Numero({ titulo, valor, sub, destaque }: { titulo: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-3">
      <p className="text-[11px] uppercase tracking-wider text-[var(--ink-mute)]">{titulo}</p>
      <p className={`mt-1 text-base font-bold ${destaque ? 'text-[var(--gold)]' : ''}`}>{valor}</p>
      {sub && <p className="text-[11px] text-[var(--ink-mute)]">{sub}</p>}
    </div>
  );
}

function Entrega({ job, agir }: { job: CourierJob; agir: (a: CourierAction) => Promise<boolean> }) {
  const [aConfirmar, setAConfirmar] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);
  const nav = navigationUrl(job.address, job.zone);
  const tel = phoneHref(job.customer_phone);
  const levantado = job.status === 'picked_up';

  // "Entregue" pede dois toques — nada de confirm() do browser (§7), e um
  // toque sem querer no bolso não fecha uma entrega.
  useEffect(() => {
    if (!aConfirmar) return;
    const t = setTimeout(() => setAConfirmar(false), 5000);
    return () => clearTimeout(t);
  }, [aConfirmar]);

  const levantar = async () => {
    setAEnviar(true);
    await agir({ action: 'pickup', deliveryId: job.delivery_id });
    setAEnviar(false);
  };
  const entregar = async () => {
    if (!aConfirmar) {
      setAConfirmar(true);
      return;
    }
    setAEnviar(true);
    const pos = await posicaoAgora();
    await agir({ action: 'deliver', deliveryId: job.delivery_id, ...(pos ?? {}) });
    setAEnviar(false);
    setAConfirmar(false);
  };

  return (
    <article className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-[family-name:var(--font-display)] text-3xl leading-none tracking-wide text-[var(--gold)]">
            {job.daily_number != null ? `#${job.daily_number}` : job.order_number}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-mute)]">{job.order_number}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            levantado ? 'bg-sky-500/20 text-sky-300' : 'bg-amber-500/20 text-amber-300'
          }`}
        >
          {levantado ? 'A caminho' : job.order_status === 'ready' ? 'Pronto na loja' : 'Na cozinha'}
        </span>
      </div>

      <div>
        <p className="font-semibold">{job.customer_name}</p>
        <p className="text-sm text-[var(--ink-dim)]">{[job.address, job.zone].filter(Boolean).join(' · ') || 'Sem morada'}</p>
        {job.notes && <p className="mt-1 rounded-lg bg-white/5 px-2 py-1 text-sm">📝 {job.notes}</p>}
      </div>

      <ul className="text-sm text-[var(--ink-dim)]">
        {job.items.map((it, i) => (
          <li key={i}>
            {it.qty}× {it.name}
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-2">
        {nav ? (
          <a href={nav} target="_blank" rel="noreferrer" className="rounded-xl border border-white/15 py-3 text-center font-semibold">
            Navegar
          </a>
        ) : (
          <span className="rounded-xl border border-white/5 py-3 text-center text-[var(--ink-mute)]">Sem morada</span>
        )}
        {tel ? (
          <a href={tel} className="rounded-xl border border-white/15 py-3 text-center font-semibold">
            Ligar
          </a>
        ) : (
          <span className="rounded-xl border border-white/5 py-3 text-center text-[var(--ink-mute)]">Sem telefone</span>
        )}
      </div>

      {levantado ? (
        <button
          onClick={entregar}
          disabled={aEnviar}
          className={`w-full rounded-xl py-4 text-lg font-bold disabled:opacity-60 ${
            aConfirmar ? 'bg-emerald-400 text-black' : 'bg-emerald-600 text-white'
          }`}
        >
          {aEnviar ? 'A registar…' : aConfirmar ? 'Tocar outra vez para confirmar' : 'Entregue ✓'}
        </button>
      ) : (
        <button
          onClick={levantar}
          disabled={aEnviar}
          className="w-full rounded-xl bg-[var(--gold)] py-4 text-lg font-bold text-black disabled:opacity-60"
        >
          {aEnviar ? 'A registar…' : 'Levantei o pedido'}
        </button>
      )}
      {job.fee_cents != null && job.fee_cents > 0 && (
        <p className="text-center text-xs text-[var(--ink-mute)]">Ganhas {money(job.fee_cents)} nesta entrega</p>
      )}
    </article>
  );
}
