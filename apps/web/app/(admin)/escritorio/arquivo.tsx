'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { DOCUMENT_CATEGORIES, daysBetween, expiryState, maputoToday, shortDate, storagePath } from '@/lib/escritorio/regras';
import { createClient } from '@/utils/supabase/client';

import { Button, Empty, Field, Message, Pill, Section, StoreSelect, inputClass, openOfficeFile, rpc, uploadOfficeFile, type Feedback, type Role, type Store } from './ui';

type Doc = {
  id: string; store_id: string | null; title: string; category: string; issuer: string | null; reference: string | null;
  issued_on: string | null; expires_on: string | null; remind_days: number; file_path: string | null; notes: string | null; archived: boolean;
};
type Draft = Omit<Doc, 'archived'> & { file: File | null };
const empty = (storeId: string | null): Draft => ({
  id: '', store_id: storeId, title: '', category: 'licenca', issuer: null, reference: null, issued_on: null, expires_on: null,
  remind_days: 30, file_path: null, notes: null, file: null,
});

/** Os papéis da empresa e das lojas, com validade e aviso antes de caducar. */
export function Arquivo({ stores, role }: { stores: Store[]; role: Role }) {
  const supabase = useMemo(() => createClient(), []);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const today = maputoToday();

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('office_documents').select('*').order('expires_on', { ascending: true, nullsFirst: false });
    if (error) setFeedback({ tone: 'erro', text: error.message });
    setDocs((data ?? []) as Doc[]);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  async function save(input: Draft, archived?: boolean) {
    if (!input.title.trim()) return setFeedback({ tone: 'erro', text: 'Dá um nome ao documento.' });
    setBusy(true);
    let filePath = input.file_path;
    if (input.file) {
      const up = await uploadOfficeFile(storagePath('documents', crypto.randomUUID(), input.file.name), input.file);
      if (!up.ok) { setBusy(false); return setFeedback({ tone: 'erro', text: up.error }); }
      filePath = up.path;
    }
    const r = await rpc('save_office_document', {
      p: { ...input, file: undefined, id: input.id || null, store_id: input.store_id || null, file_path: filePath, ...(archived === undefined ? {} : { archived }) },
    });
    setBusy(false);
    if (!r.ok) return setFeedback({ tone: 'erro', text: r.error });
    setFeedback({ tone: 'ok', text: archived ? 'Documento arquivado: deixa de avisar.' : 'Documento guardado.' });
    setDraft(null);
    void load();
  }

  const list = (docs ?? []).filter((d) => d.archived === showArchived);
  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.short_name ?? '' : 'Empresa');
  const canEdit = (d: { store_id: string | null }) => role === 'owner' || d.store_id !== null;

  return (
    <Section
      title="Arquivo"
      subtitle="Guarda a cópia digital e a validade. O dono recebe um email antes de caducar."
      actions={<>
        <Button tone="ghost" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Ver em uso' : 'Ver arquivados'}</Button>
        <Button onClick={() => setDraft(empty(role === 'owner' ? null : stores[0]?.id ?? null))}>Novo documento</Button>
      </>}
    >
      <Message feedback={feedback} />
      {draft && (
        <div className="space-y-3 rounded-xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.05] p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Documento"><input className={inputClass} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Licença sanitária" /></Field>
            <Field label="Tipo">
              <select className={inputClass} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                {Object.entries(DOCUMENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="De quem é">
              <StoreSelect stores={stores} value={draft.store_id ?? ''} onChange={(v) => setDraft({ ...draft, store_id: v || null })} allowCompany={role === 'owner'} />
            </Field>
            <Field label="Emitido por"><input className={inputClass} value={draft.issuer ?? ''} onChange={(e) => setDraft({ ...draft, issuer: e.target.value || null })} placeholder="Município de Maputo" /></Field>
            <Field label="Referência"><input className={inputClass} value={draft.reference ?? ''} onChange={(e) => setDraft({ ...draft, reference: e.target.value || null })} /></Field>
            <Field label="Emitido em"><input className={inputClass} type="date" value={draft.issued_on ?? ''} onChange={(e) => setDraft({ ...draft, issued_on: e.target.value || null })} /></Field>
            <Field label="Válido até" hint="Vazio se não caduca."><input className={inputClass} type="date" value={draft.expires_on ?? ''} onChange={(e) => setDraft({ ...draft, expires_on: e.target.value || null })} /></Field>
            <Field label="Avisar com quantos dias"><input className={inputClass} type="number" min={0} max={180} value={draft.remind_days} onChange={(e) => setDraft({ ...draft, remind_days: Number(e.target.value) })} /></Field>
            <Field label="Cópia (foto ou PDF)" hint={draft.file_path && !draft.file ? 'Já tem cópia. Escolhe outra para substituir.' : 'Até 10 MB.'}>
              <input className={inputClass} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] ?? null })} />
            </Field>
            <Field label="Notas" wide><input className={inputClass} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} /></Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void save(draft)} disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</Button>
            <Button tone="ghost" onClick={() => setDraft(null)} disabled={busy}>Cancelar</Button>
          </div>
        </div>
      )}
      {!docs ? <p className="text-sm text-[#8b8378]">A carregar…</p> : list.length === 0 ? (
        <Empty>{showArchived ? 'Nada arquivado.' : 'Ainda sem documentos. Começa pelo alvará e pela licença sanitária.'}</Empty>
      ) : (
        <div className="space-y-2">
          {list.map((d) => {
            const state = expiryState(d.expires_on, d.remind_days, today);
            const left = d.expires_on ? daysBetween(today, d.expires_on) : null;
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white">
                    {d.title}{' '}
                    {state === 'caducado' && <Pill tone="red">Caducado</Pill>}
                    {state === 'a_caducar' && <Pill tone="amber">Caduca em {left} dia(s)</Pill>}
                    {state === 'valido' && <Pill tone="green">Válido</Pill>}
                  </p>
                  <p className="text-xs text-[#8b8378]">
                    {DOCUMENT_CATEGORIES[d.category] ?? d.category} · {storeName(d.store_id)}
                    {d.issuer && ` · ${d.issuer}`}{d.reference && ` · ${d.reference}`}
                    {d.expires_on ? ` · válido até ${shortDate(d.expires_on)}` : ' · sem validade'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {d.file_path && <Button tone="ghost" onClick={() => void openOfficeFile(d.file_path!)}>Ver cópia</Button>}
                  {canEdit(d) && !d.archived && (
                    <>
                      <Button tone="ghost" onClick={() => setDraft({ ...d, file: null })}>Editar</Button>
                      <Button tone="ghost" onClick={() => void save({ ...d, file: null }, true)}>Arquivar</Button>
                    </>
                  )}
                  {canEdit(d) && d.archived && <Button tone="ghost" onClick={() => void save({ ...d, file: null }, false)}>Repor</Button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
