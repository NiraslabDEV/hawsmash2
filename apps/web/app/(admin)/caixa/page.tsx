'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { formatMT, type Cents } from '@delivery/core';

// ─── Types ───────────────────────────────────────────────────────────────────

type Stats = {
  total_pedidos: number;
  total_faturado_cents: number;
  total_entregues: number;
  em_aberto_cents: number;
};

type ItemVendido = {
  name: string;
  qty: number;
  total_cents: number;
};

type HistoricoItem = {
  id: string;
  opened_at: string;
  closed_at: string;
  expected_cash_cents: number;
  counted_cash_cents: number;
  difference_cents: number;
  notes: string | null;
};

type Dashboard = {
  has_open_session: boolean;
  open_session: { id: string; opened_at: string } | null;
  period_start: string;
  stats: Stats;
  items_hoje: ItemVendido[];
  historico: HistoricoItem[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const GLASS = 'rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]';

function fmtDT(iso: string) {
  return new Date(iso).toLocaleString('pt-MZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' });
}

function diffColor(diff: number) {
  if (diff === 0) return 'text-[#C9BCAC]';
  return diff > 0 ? 'text-[#22C55E]' : 'text-[#EF4444]';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CaixaPage() {
  const supabase = createClient();

  const [dashboard, setDashboard]       = useState<Dashboard | null>(null);
  const [loading, setLoading]           = useState(true);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [countedInput, setCountedInput] = useState('');
  const [notes, setNotes]               = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [message, setMessage]           = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ─── Fetch dashboard ──────────────────────────────────────────────────────

  const fetchDashboard = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_cash_dashboard');
    if (error) {
      setMessage({ type: 'error', text: `Erro ao carregar painel: ${error.message}` });
    } else {
      setDashboard(data as Dashboard);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // ─── Open session ─────────────────────────────────────────────────────────

  async function handleOpenSession() {
    setSubmitting(true);
    const { error } = await supabase.rpc('open_cash_session');
    if (error) {
      setMessage({ type: 'error', text: `Erro ao abrir sessão: ${error.message}` });
    } else {
      setMessage({ type: 'success', text: 'Sessão de caixa aberta.' });
      fetchDashboard();
    }
    setSubmitting(false);
  }

  // ─── Close session ────────────────────────────────────────────────────────

  async function handleClose() {
    const centavos = Math.round(parseFloat(countedInput.replace(',', '.')) * 100);
    if (isNaN(centavos) || centavos < 0) {
      setMessage({ type: 'error', text: 'Valor contado inválido.' });
      return;
    }

    setSubmitting(true);
    const { data: report, error } = await supabase.rpc('close_cash_session', {
      p_counted_cents: centavos,
      p_notes: notes.trim() || null,
    });

    if (error) {
      setMessage({ type: 'error', text: `Erro ao fechar caixa: ${error.message}` });
      setSubmitting(false);
      return;
    }

    await sendCloseEmail(report.session_id as string);

    setMessage({ type: 'success', text: 'Caixa fechada com sucesso!' });
    setShowCloseModal(false);
    setCountedInput('');
    setNotes('');
    fetchDashboard();
    setSubmitting(false);
  }

  async function sendCloseEmail(sessionId: string) {
    try {
      await fetch('/api/emails/send-cash-close-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      // email é best-effort; não bloqueia o fecho
    }
  }

  // ─── Computed ─────────────────────────────────────────────────────────────

  const countedCents = Math.round(parseFloat(countedInput.replace(',', '.')) * 100) || 0;
  const expectedCents = dashboard?.stats.total_faturado_cents ?? 0;
  const diffCents = countedCents - expectedCents;

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-[#F5A623] font-semibold animate-pulse">A carregar caixa…</div>
      </div>
    );
  }

  const d = dashboard!;

  return (
    <div className="space-y-6">

      {/* Header: sessão + botões */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Caixa</h1>
          {d.has_open_session && d.open_session ? (
            <p className="text-sm text-[#C9BCAC] mt-1">
              Sessão aberta desde {fmtTime(d.open_session.opened_at)} ·{' '}
              <span className="text-[#F5A623]">período activo</span>
            </p>
          ) : (
            <p className="text-sm text-[#C9BCAC] mt-1">
              Sem sessão aberta · a mostrar dados de hoje
            </p>
          )}
        </div>
        <div className="flex gap-3">
          {!d.has_open_session && (
            <button
              onClick={handleOpenSession}
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#F3E4CE] hover:bg-white/[0.08] transition-all disabled:opacity-50"
            >
              Abrir Sessão
            </button>
          )}
          <button
            onClick={() => setShowCloseModal(true)}
            className="px-5 py-2 text-sm font-bold bg-[#F5A623] text-[#2A1710] rounded-xl hover:bg-[#D6860F] transition-all shadow-[0_0_16px_rgba(245,166,35,0.25)]"
          >
            Fechar Caixa
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Pedidos" value={String(d.stats.total_pedidos)} accentBorder="border-t-[#3B82F6]/60" />
        <StatCard label="Faturado" value={formatMT(d.stats.total_faturado_cents as unknown as Cents)} highlight accentBorder="border-t-[#22C55E]/60" />
        <StatCard label="Entregues" value={String(d.stats.total_entregues)} accentBorder="border-t-[#8B5CF6]/60" />
        <StatCard label="Em Aberto" value={formatMT(d.stats.em_aberto_cents as unknown as Cents)} accentBorder="border-t-[#F59E0B]/60" />
      </div>

      {/* Itens Vendidos */}
      <div className={`${GLASS} p-6`}>
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">
          Vendido por Unidade
        </h3>
        {d.items_hoje.length === 0 ? (
          <p className="text-[#C9BCAC] text-sm">Nenhum item vendido no período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[#8A7A69] border-b border-white/[0.06]">
                <th className="pb-2 font-medium">Produto</th>
                <th className="pb-2 font-medium text-center">Qtd</th>
                <th className="pb-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.items_hoje.map((item, i) => (
                <tr key={i} className="border-b border-white/[0.04] last:border-0">
                  <td className="py-2 text-white">{item.name}</td>
                  <td className="py-2 text-center text-[#C9BCAC]">{item.qty}</td>
                  <td className="py-2 text-right text-white font-medium">
                    {formatMT(item.total_cents as unknown as Cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Histórico de Fechos */}
      <div className={`${GLASS} p-6`}>
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">
          Histórico de Fechos
        </h3>
        {d.historico.length === 0 ? (
          <p className="text-[#C9BCAC] text-sm">Nenhum fecho registado ainda.</p>
        ) : (
          <div className="space-y-3">
            {d.historico.map((h) => (
              <HistoricoRow key={h.id} item={h} />
            ))}
          </div>
        )}
      </div>

      {/* Modal: Fechar Caixa */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.10] bg-white/[0.06] backdrop-blur-[20px] shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(245,166,35,0.08)] p-6 space-y-5">
            <h3 className="text-lg font-bold text-white">Fechar Caixa</h3>

            {d.has_open_session && d.open_session && (
              <p className="text-sm text-[#C9BCAC]">
                Período: {fmtDT(d.open_session.opened_at)} → agora
              </p>
            )}

            <div className="bg-black/20 border border-white/[0.08] rounded-xl p-4 space-y-2 text-sm">
              <Row label="Total Esperado" value={formatMT(d.stats.total_faturado_cents as unknown as Cents)} bold />
              <Row label="Pedidos Confirmados" value={String(d.stats.total_pedidos)} />
              <Row label="Entregues" value={String(d.stats.total_entregues)} />
            </div>

            <div>
              <label className="block text-sm text-[#C9BCAC] mb-1">Valor Contado (MT)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={countedInput}
                onChange={(e) => setCountedInput(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-black/30 border border-white/[0.08] rounded-xl text-white focus:outline-none focus:border-[#F5A623]/50 text-lg font-mono transition-colors"
              />
            </div>

            {countedInput && (
              <div className="bg-black/20 border border-white/[0.08] rounded-xl p-3 text-sm flex justify-between">
                <span className="text-[#C9BCAC]">Diferença</span>
                <span className={`font-bold ${diffColor(diffCents)}`}>
                  {diffCents >= 0 ? '+' : ''}{formatMT(diffCents as unknown as Cents)}
                </span>
              </div>
            )}

            <div>
              <label className="block text-sm text-[#C9BCAC] mb-1">Notas (opcional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Observações sobre o fecho…"
                className="w-full px-3 py-2 bg-black/30 border border-white/[0.08] rounded-xl text-white focus:outline-none focus:border-[#F5A623]/50 resize-none text-sm transition-colors"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowCloseModal(false); setCountedInput(''); setNotes(''); }}
                disabled={submitting}
                className="flex-1 px-4 py-2 text-sm text-[#C9BCAC] bg-white/[0.06] hover:bg-white/[0.10] rounded-xl transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleClose}
                disabled={submitting || !countedInput}
                className="flex-1 px-4 py-2 text-sm font-bold bg-[#F5A623] text-[#2A1710] rounded-xl hover:bg-[#D6860F] transition-all disabled:opacity-50"
              >
                {submitting ? 'A fechar…' : 'Confirmar Fecho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {message && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-2xl border backdrop-blur-[16px] px-5 py-3 font-medium text-sm shadow-[0_4px_24px_rgba(0,0,0,0.4)] ${
          message.type === 'success' ? 'border-[#22C55E]/30 bg-[#22C55E]/10 text-[#22C55E]' : 'border-[#F5A623]/30 bg-[#F5A623]/10 text-[#F5A623]'
        }`}>
          <div className="flex items-center gap-3">
            <span>{message.text}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => setMessage(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, highlight, accentBorder }: { label: string; value: string; highlight?: boolean; accentBorder: string }) {
  return (
    <div className={`${GLASS} border-t-2 ${accentBorder} p-5 hover:bg-white/[0.07] hover:border-white/[0.12] transition-all`}>
      <p className="text-[11px] text-[#8A7A69] uppercase tracking-wide mb-2 font-medium">{label}</p>
      <p className={`text-2xl font-bold ${highlight ? 'text-[#F5A623]' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#C9BCAC]">{label}</span>
      <span className={bold ? 'text-white font-bold' : 'text-[#F3E4CE]'}>{value}</span>
    </div>
  );
}

function HistoricoRow({ item }: { item: HistoricoItem }) {
  const diff = item.difference_cents;

  function handlePDF() {
    window.open(`/api/cash-sessions/${item.id}/report`, '_blank');
  }

  async function handleEmail() {
    const res = await fetch('/api/emails/send-cash-close-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: item.id }),
    });
    if (res.ok) alert('Email reenviado.');
    else alert('Erro ao reenviar email.');
  }

  return (
    <div className="flex items-center gap-4 p-3 bg-black/20 border border-white/[0.08] rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[#C9BCAC]">{fmtDT(item.opened_at)} → {fmtDT(item.closed_at)}</p>
        {item.notes && <p className="text-xs text-[#8A7A69] mt-0.5 truncate">{item.notes}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm text-white font-medium">
          {formatMT(item.expected_cash_cents as unknown as Cents)}
        </p>
        <p className={`text-xs font-medium ${diffColor(diff)}`}>
          {diff >= 0 ? '+' : ''}{formatMT(diff as unknown as Cents)}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={handlePDF}
          title="Descarregar PDF"
          className="px-3 py-1.5 text-xs rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#C9BCAC] hover:text-white hover:bg-white/[0.08] transition-all"
        >
          PDF
        </button>
        <button
          onClick={handleEmail}
          title="Reenviar email"
          className="px-3 py-1.5 text-xs rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#C9BCAC] hover:text-white hover:bg-white/[0.08] transition-all"
        >
          Email
        </button>
      </div>
    </div>
  );
}
