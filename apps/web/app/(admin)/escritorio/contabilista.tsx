'use client';

import { useCallback, useEffect, useState } from 'react';

import { shortDate } from '@/lib/escritorio/regras';

import { Button, Empty, Field, Message, Pill, Section, inputClass, rpc, type Feedback } from './ui';

type Access = { id: string; label: string; created_at: string; expires_at: string; revoked_at: string | null; last_used_at: string | null };

/**
 * Uma ligação só de leitura para o contabilista: vê o resumo dos últimos meses e descarrega o ficheiro das facturas
 * e as compras. Não vê pedidos, clientes nem pessoal. O endereço só aparece uma vez; depois só se pode revogar.
 */
export function Contabilista() {
  const [list, setList] = useState<Access[] | null>(null);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(90);
  const [link, setLink] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    const r = await rpc<Access[]>('list_accountant_access');
    if (r.ok) setList(r.data);
    else setFeedback({ tone: 'erro', text: r.error });
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    const r = await rpc<{ token: string }>('create_accountant_access', { p_label: label, p_days: days });
    if (!r.ok) return setFeedback({ tone: 'erro', text: r.error });
    // O token vai depois do "#": o browser não o manda ao servidor, por isso não fica em registo nenhum.
    setLink(`${window.location.origin}/contabilista#${r.data.token}`);
    setLabel('');
    setFeedback({ tone: 'ok', text: 'Acesso criado. Copia o endereço agora: não volta a aparecer.' });
    void load();
  }

  async function revoke(item: Access) {
    const r = await rpc<Access[]>('revoke_accountant_access', { p_id: item.id });
    if (r.ok) setList(r.data);
    setFeedback(r.ok ? { tone: 'ok', text: `Acesso de ${item.label} revogado.` } : { tone: 'erro', text: r.error });
  }

  const now = Date.now();
  return (
    <Section title="Acesso do contabilista" subtitle="O contabilista abre o endereço no browser e descarrega o mês. Sem conta, sem palavra-passe, sem ver vendas a clientes.">
      <Message feedback={feedback} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Para quem"><input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome do contabilista" /></Field>
        <Field label="Válido por (dias)"><input className={inputClass} type="number" min={1} max={366} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
        <div className="flex items-end"><Button onClick={() => void create()} disabled={!label.trim()}>Criar acesso</Button></div>
      </div>
      {link && (
        <div className="space-y-2 rounded-xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.05] p-4">
          <p className="text-sm text-white">Envia este endereço ao contabilista por um canal privado:</p>
          <input className={inputClass} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex gap-2">
            <Button onClick={() => void navigator.clipboard.writeText(link).then(() => setFeedback({ tone: 'ok', text: 'Endereço copiado.' }))}>Copiar</Button>
            <Button tone="ghost" onClick={() => setLink(null)}>Já copiei</Button>
          </div>
        </div>
      )}
      {!list ? <p className="text-sm text-[#8b8378]">A carregar…</p> : list.length === 0 ? <Empty>Nenhum acesso criado.</Empty> : (
        <div className="space-y-2">
          {list.map((a) => {
            const expired = Date.parse(a.expires_at) < now;
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white">
                    {a.label}{' '}
                    {a.revoked_at ? <Pill tone="grey">Revogado</Pill> : expired ? <Pill tone="grey">Expirou</Pill> : <Pill tone="green">Activo</Pill>}
                  </p>
                  <p className="text-xs text-[#8b8378]">
                    Criado {shortDate(a.created_at)} · válido até {shortDate(a.expires_at)}
                    {a.last_used_at ? ` · última visita ${shortDate(a.last_used_at)}` : ' · ainda não usado'}
                  </p>
                </div>
                {!a.revoked_at && !expired && <Button tone="danger" onClick={() => void revoke(a)}>Revogar</Button>}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
