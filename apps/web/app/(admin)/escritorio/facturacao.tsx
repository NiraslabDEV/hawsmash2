'use client';

import { useCallback, useEffect, useState } from 'react';

import { cleanNuit, formatNuit, isValidNuit, shortDate } from '@/lib/escritorio/regras';

import { Button, Field, Message, Pill, Section, inputClass, rpc, type Feedback } from './ui';

type Settings = {
  active: boolean; legal_name: string; nuit: string; address: string; regime: 'normal' | 'ispc' | 'isento'; vat_bp: number;
  exemption_reason: string; at_certificate: string; active_since: string | null; auto_print: boolean;
  documents: number; pending: number; failures_24h: number;
};

/**
 * Os dados fiscais da empresa e o interruptor (ADR 0013). Ligar grava o instante: as vendas pagas antes nunca são
 * facturadas. Desligar não apaga nada.
 */
export function Facturacao() {
  const [s, setS] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);

  const load = useCallback(async () => {
    const r = await rpc<Settings>('get_fiscal_settings');
    if (!r.ok) return setFeedback({ tone: 'erro', text: r.error });
    setS(r.data);
    setForm(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function check(f: Settings, activating: boolean): string | null {
    if (!activating) return null;
    if (!f.legal_name.trim()) return 'Falta o nome legal (como no registo comercial).';
    if (!isValidNuit(f.nuit)) return 'O NUIT da empresa tem 9 dígitos.';
    if (!f.address.trim()) return 'Falta a morada da sede.';
    if (f.regime === 'isento' && f.exemption_reason.trim().length < 10) return 'No regime isento, escreve o motivo (o artigo da lei).';
    return null;
  }

  async function save(active: boolean) {
    if (!form) return;
    const error = check(form, active);
    if (error) return setFeedback({ tone: 'erro', text: error });
    setBusy(true);
    const r = await rpc<Settings>('save_fiscal_settings', {
      p: { ...form, active, nuit: cleanNuit(form.nuit), vat_bp: form.regime === 'normal' ? form.vat_bp : 0 },
    });
    setBusy(false);
    setConfirmOn(false);
    if (!r.ok) return setFeedback({ tone: 'erro', text: r.error });
    setS(r.data);
    setForm(r.data);
    setFeedback({ tone: 'ok', text: active && !s?.active ? 'Facturação ligada. As vendas pagas a partir de agora levam Factura-Recibo.' : active ? 'Dados guardados.' : 'Facturação desligada. Nenhum documento foi apagado.' });
  }

  async function emitPending() {
    const r = await rpc<number>('fiscal_emit_pending', { p_limit: 200 });
    setFeedback(r.ok ? { tone: 'ok', text: `${r.data} factura(s) emitida(s).` } : { tone: 'erro', text: r.error });
    void load();
  }

  async function verify() {
    const r = await rpc<{ ok: boolean; documents: number; broken: Array<{ number: string; reason: string }> }>('fiscal_verify_chain');
    if (!r.ok) return setFeedback({ tone: 'erro', text: r.error });
    setFeedback(r.data.ok
      ? { tone: 'ok', text: `Cadeia íntegra: ${r.data.documents} documento(s) verificados, sem falhas.` }
      : { tone: 'erro', text: `A cadeia falha em ${r.data.broken.map((b) => b.number).join(', ')}. Contacta o suporte antes de entregar ficheiros.` });
  }

  if (!form || !s) return <Section title="Facturação"><Message feedback={feedback} /><p className="text-sm text-[#8b8378]">A carregar…</p></Section>;
  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch });

  return (
    <>
      <Section
        title="Estado"
        subtitle={s.active ? `Ligada desde ${shortDate(s.active_since)}.` : 'Desligada: as vendas continuam a sair com o talão de sempre, sem valor fiscal.'}
        actions={s.active
          ? <Button tone="danger" onClick={() => void save(false)} disabled={busy}>Desligar</Button>
          : <Button onClick={() => setConfirmOn(true)} disabled={busy}>Ligar a facturação</Button>}
      >
        <Message feedback={feedback} />
        <div className="flex flex-wrap gap-2">
          {s.active ? <Pill tone="green">Ligada</Pill> : <Pill tone="grey">Desligada</Pill>}
          <Pill tone="grey">{s.documents} documento(s)</Pill>
          {s.pending > 0 && <Pill tone="red">{s.pending} venda(s) paga(s) sem factura</Pill>}
          {s.failures_24h > 0 && <Pill tone="amber">{s.failures_24h} falha(s) nas últimas 24 h</Pill>}
          {!s.at_certificate && <Pill tone="amber">Programa ainda sem certificação da AT</Pill>}
        </div>
        {confirmOn && (
          <div className="space-y-2 rounded-xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.05] p-4 text-sm text-white">
            <p>Ao ligar:</p>
            <ul className="ml-5 list-disc text-[#C9BCAC]">
              <li>cada venda paga a partir de agora leva uma Factura-Recibo com número da série da loja;</li>
              <li>as vendas pagas antes de agora nunca são facturadas;</li>
              <li>um documento emitido não se altera nem se apaga — corrige-se com Nota de Crédito.</li>
            </ul>
            <div className="flex gap-2 pt-1">
              <Button onClick={() => void save(true)} disabled={busy}>Ligar agora</Button>
              <Button tone="ghost" onClick={() => setConfirmOn(false)}>Cancelar</Button>
            </div>
          </div>
        )}
        {s.active && (
          <div className="flex flex-wrap gap-2">
            <Button tone="ghost" onClick={() => void emitPending()}>Emitir pendentes</Button>
            <Button tone="ghost" onClick={() => void verify()}>Verificar integridade</Button>
          </div>
        )}
      </Section>

      <Section title="Dados fiscais da empresa" subtitle="Ficam gravados em cada documento no momento da emissão. Mudar depois não altera documentos já emitidos.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome legal" hint="Como no registo comercial."><input className={inputClass} value={form.legal_name} onChange={(e) => set({ legal_name: e.target.value })} /></Field>
          <Field label="NUIT da empresa" hint={isValidNuit(form.nuit) ? formatNuit(form.nuit) : '9 dígitos.'}><input className={inputClass} inputMode="numeric" value={form.nuit} onChange={(e) => set({ nuit: e.target.value })} /></Field>
          <Field label="Morada da sede" wide><input className={inputClass} value={form.address} onChange={(e) => set({ address: e.target.value })} /></Field>
          <Field label="Regime de IVA">
            <select className={inputClass} value={form.regime} onChange={(e) => set({ regime: e.target.value as Settings['regime'] })}>
              <option value="normal">Regime normal (com IVA)</option>
              <option value="ispc">ISPC (simplificado)</option>
              <option value="isento">Isento</option>
            </select>
          </Field>
          {form.regime === 'normal' && (
            <Field label="Taxa de IVA (%)" hint="A taxa normal em Moçambique é 16 %.">
              <input className={inputClass} type="number" step="0.01" min={0} max={50} value={form.vat_bp / 100} onChange={(e) => set({ vat_bp: Math.round(Number(e.target.value) * 100) })} />
            </Field>
          )}
          {form.regime === 'isento' && (
            <Field label="Motivo da isenção" hint="O artigo da lei, como sai no documento." wide>
              <input className={inputClass} value={form.exemption_reason} onChange={(e) => set({ exemption_reason: e.target.value })} />
            </Field>
          )}
          <Field label="N.º de certificação da AT" hint="Só preencher quando a AT o atribuir. Até lá, nada sobre certificação sai no papel.">
            <input className={inputClass} value={form.at_certificate} onChange={(e) => set({ at_certificate: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 self-end text-sm text-[#C9BCAC]">
            <input type="checkbox" checked={form.auto_print} onChange={(e) => set({ auto_print: e.target.checked })} />
            Imprimir a factura sozinha na loja quando a venda fica paga
          </label>
        </div>
        <Button onClick={() => void save(s.active)} disabled={busy}>Guardar dados</Button>
      </Section>
    </>
  );
}
