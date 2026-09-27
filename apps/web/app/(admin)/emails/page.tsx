'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { staffFetch } from '@/lib/admin/staff-fetch';
import {
  defaultStep,
  flowSchema,
  triggerLabels,
  type EmailFlow,
} from '@/lib/email/studio';
import { SystemPanel } from './system-panel';
import { CampaignGenerator } from './campaign-generator';
import type {
  SystemTemplate,
  SystemEmailKey,
} from '@/lib/email/system-catalog';
import { FlowEditor } from './flow-editor';
import { SettingsPanel } from './settings-panel';
import { ContactsPanel } from './contacts-panel';
import {
  fieldClass,
  buttonClass,
  primaryClass,
  type Settings,
  type Contact,
} from './shared';

type Job = {
  id: string;
  recipient: string;
  step_index: number;
  status: string;
  due_at: string | null;
  sent_at: string | null;
  error: string | null;
};
type Data = {
  systemTemplates: SystemTemplate[];
  previews: Record<SystemEmailKey, { subject: string; html: string }>;
  globalStoreName: string;
  knowledge: string;
  brandContext: { name: string; store: string; tagline?: string; products?: string[] };
  delivery: {
    id: string;
    event: string;
    recipient: string;
    status: string;
    created_at: string;
  }[];
  deliveryCount: number;
  ownerEmail: string;
  centralOwnerEmail: string;
  settings: Settings | null;
  flows: EmailFlow[];
  contacts: Contact[];
  contactCount: number;
  jobs: Job[];
  jobCount: number;
};
const tabs = [
  { id: 'transactional', label: 'Transaccionais' },
  { id: 'marketing', label: 'Promoções e funis' },
  { id: 'contacts', label: 'Contactos' },
  { id: 'history', label: 'Histórico' },
  { id: 'settings', label: 'Configuração' },
] as const;
const statuses: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Activo',
  paused: 'Pausado',
  queued: 'Na fila',
  sending: 'A enviar',
  sent: 'Aceite pelo SMTP',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  uncertain: 'Por confirmar',
  disabled: 'Desligado',
};
const date = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat('pt-PT', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Africa/Maputo',
      }).format(new Date(s))
    : 'Aguarda etapa anterior';

export default function EmailsPage() {
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [store, setStore] = useState('');
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('transactional');
  const [data, setData] = useState<Data | null>(null);
  const [editor, setEditor] = useState<EmailFlow | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const version = useRef(0);
  useEffect(() => {
    let live = true;
    void staffFetch('/api/email-studio')
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        if (live) {
          setStores(body.stores);
          setStore(body.stores[0]?.id ?? '');
        }
      })
      .catch((e) => {
        if (live) setError(String(e.message));
      });
    return () => {
      live = false;
    };
  }, []);
  const load = useCallback(async () => {
    if (!store) return;
    const current = ++version.current;
    try {
      const r = await staffFetch(
        `/api/email-studio?store=${store}&offset=${offset}`,
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      if (version.current === current) setData(body);
    } catch (e) {
      if (version.current === current)
        setError(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, [store, offset]);
  useEffect(() => {
    setData(null);
    setError('');
    void load();
    return () => {
      version.current++;
    };
  }, [load]);
  async function action(action: string, payload: unknown) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await staffFetch('/api/email-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, store_id: store, data: payload }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setMessage(
        action === 'verify'
          ? 'Ligação SMTP verificada. Nenhum email foi enviado.'
          : action === 'enrol'
            ? `${body.queued} mensagens adicionadas à fila. Inscrições anteriores não se repetem.`
            : 'Alterações guardadas.',
      );
      await load();
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível guardar.');
      return null;
    } finally {
      setBusy(false);
    }
  }
  function create(kind: 'transactional' | 'marketing') {
    const available = (
      ['paid', 'cancelled', 'ready', 'delivered'] as const
    ).find(
      (trigger) =>
        !data?.flows.some(
          (f) => f.kind === 'transactional' && f.trigger === trigger,
        ),
    );
    if (kind === 'transactional' && !available) {
      setError(
        'Já tens uma sequência para cada evento. Abre uma delas para editar.',
      );
      return;
    }
    setEditor({
      name: kind === 'marketing' ? 'Novo funil' : triggerLabels[available!],
      kind,
      trigger: kind === 'marketing' ? 'manual' : available!,
      status: 'draft',
      steps: [defaultStep()],
    });
  }
  const kind = tab === 'marketing' ? 'marketing' : 'transactional';
  const flows = data?.flows.filter((f) => f.kind === kind) ?? [];
  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 text-[#f5f0e8] space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[.2em] text-[#e5a93c] uppercase">
            Relacionamento com o cliente
          </p>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight">
            Emails
          </h1>
          <p className="mt-2 text-sm text-[#b4aa9c]">
            A mensagem certa, no momento que escolheres.
          </p>
        </div>
        <label className="w-full sm:w-64 text-xs text-[#b4aa9c]">
          Loja
          <select
            disabled={busy || !!editor}
            value={store}
            onChange={(e) => {
              setStore(e.target.value);
              setOffset(0);
              setMessage('');
            }}
            className={fieldClass + ' mt-1'}
            aria-label="Loja dos emails"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <nav
        aria-label="Secções de emails"
        className="flex gap-1 overflow-x-auto border-b border-white/10 pb-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            disabled={!!editor || busy}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => {
              setTab(t.id);
              setOffset(0);
              setMessage('');
            }}
            className={`min-h-12 whitespace-nowrap rounded-t-xl px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-[#e5a93c] ${tab === t.id ? 'border-b-2 border-[#e5a93c] bg-[#e5a93c]/10 text-[#e5a93c]' : 'text-[#b4aa9c] hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-700/50 bg-red-950/40 p-4 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-xl border border-emerald-700/50 bg-emerald-950/30 p-4 text-sm text-emerald-200"
        >
          {message}
        </p>
      )}
      {!data ? (
        <div className="rounded-2xl border border-white/10 p-10 text-[#b4aa9c]">
          {error ? (
            <button className={buttonClass} onClick={() => void load()}>
              Tentar novamente
            </button>
          ) : (
            'A carregar emails…'
          )}
        </div>
      ) : editor ? (
        <FlowEditor
          value={editor}
          onChange={setEditor}
          busy={busy}
          storeName={stores.find((s) => s.id === store)?.name ?? ''}
          onClose={() => {
            setEditor(null);
            setError('');
          }}
          onSave={async () => {
            const parsed = flowSchema.safeParse(editor);
            if (!parsed.success) {
              setError(
                'Revê o assunto, intervalos e endereços https dos blocos.',
              );
              return;
            }
            const saved = await action('flow', {
              ...parsed.data,
              id: editor.id,
            });
            if (saved) setEditor(null);
          }}
        />
      ) : tab === 'transactional' || tab === 'marketing' ? (
        <>
          {kind === 'transactional' ? (
            <SystemPanel
              key={store}
              templates={data.systemTemplates}
              previews={data.previews}
              storeName={stores.find((s) => s.id === store)?.name ?? ''}
              globalStoreName={data.globalStoreName}
              flows={data.flows}
              busy={busy}
              onSave={(v) => action('system', v)}
              onOpenFlow={setEditor}
            />
          ) : (
            <CampaignGenerator
              key={store}
              brand={data.brandContext}
              knowledge={data.knowledge}
              onKnowledgeSave={(notes) => action('knowledge', { notes })}
              onGenerated={setEditor}
            />
          )}
          <div className="flex flex-wrap justify-between items-center gap-4">
            <div>
              <h2 className="text-xl font-bold">
                {kind === 'marketing'
                  ? 'Os teus funis'
                  : 'Sequências de acompanhamento'}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-[#b4aa9c]">
                {kind === 'marketing'
                  ? 'Cria campanhas e sequências. Cada contacto entra uma vez por funil, sempre com consentimento.'
                  : 'Personaliza cada evento e acrescenta mensagens de acompanhamento. Os intervalos contam a partir do envio anterior.'}
              </p>
            </div>
            <button className={primaryClass} onClick={() => create(kind)}>
              + {kind === 'marketing' ? 'Criar funil' : 'Nova sequência'}
            </button>
          </div>
          {!(data.settings?.enabled && data.settings?.password_configured) && (
            <div className="flex flex-wrap justify-between gap-3 rounded-xl border border-[#e5a93c]/25 bg-[#e5a93c]/5 p-4 text-sm">
              <span>
                Configura o remetente para começar a enviar. Podes preparar os
                teus emails agora.
              </span>
              <button
                onClick={() => setTab('settings')}
                className="font-semibold text-[#e5a93c] underline"
              >
                Configurar envio
              </button>
            </div>
          )}
          {flows.length === 0 &&
          kind === 'transactional' ? null : flows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/20 py-16 px-6 text-center">
              <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[#e5a93c]/10 text-[#e5a93c]">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M3 5h18v14H3zM3 6l9 7 9-7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold">
                {kind === 'marketing'
                  ? 'Uma conversa que continua'
                  : 'Dá a tua voz aos emails da loja'}
              </h3>
              <p className="mx-auto my-3 max-w-lg text-sm text-[#b4aa9c]">
                {kind === 'marketing'
                  ? 'Boas-vindas hoje, uma novidade amanhã, uma oferta na próxima semana. Tu defines a sequência.'
                  : 'Confirmação, pedido pronto ou agradecimento: escolhe o evento, personaliza os blocos e define quando enviar.'}
              </p>
              <button
                className={primaryClass + ' mt-3'}
                onClick={() => create(kind)}
              >
                Criar{' '}
                {kind === 'marketing' ? 'primeiro funil' : 'primeira sequência'}
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {flows.map((f) => (
                <article
                  key={f.id}
                  className="rounded-2xl border border-white/10 bg-[#1c1915] p-5"
                >
                  <div className="flex justify-between gap-3">
                    <span className="text-xs uppercase tracking-wide text-[#b4aa9c]">
                      {triggerLabels[f.trigger]}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${f.status === 'active' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-white/5 text-[#c4bbaf]'}`}
                    >
                      {statuses[f.status]}
                    </span>
                  </div>
                  <h3 className="mt-4 text-xl font-bold">{f.name}</h3>
                  <p className="mt-2 text-sm text-[#b4aa9c]">
                    {f.steps.length}{' '}
                    {f.steps.length === 1 ? 'mensagem' : 'mensagens'} ·{' '}
                    {f.steps[0].delay_minutes === 0
                      ? 'Começa imediatamente'
                      : `Começa após ${f.steps[0].delay_minutes} min`}
                  </p>
                  <div
                    className="my-5 flex items-center gap-1"
                    aria-hidden="true"
                  >
                    {f.steps.map((_, i) => (
                      <span
                        key={i}
                        className="h-1.5 flex-1 rounded-full bg-[#e5a93c]/40"
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={buttonClass}
                      onClick={() => setEditor(structuredClone(f))}
                    >
                      Editar
                    </button>
                    <button
                      disabled={busy}
                      className={buttonClass}
                      onClick={() =>
                        void action('flow', {
                          ...f,
                          status: f.status === 'active' ? 'paused' : 'active',
                        })
                      }
                    >
                      {f.status === 'active' ? 'Pausar' : 'Activar'}
                    </button>
                    {f.kind === 'marketing' && (
                      <button
                        className={buttonClass}
                        onClick={() =>
                          setEditor({
                            ...structuredClone(f),
                            id: undefined,
                            name: `${f.name} — cópia`,
                            status: 'draft',
                          })
                        }
                      >
                        Duplicar
                      </button>
                    )}
                  </div>
                  {f.kind === 'marketing' &&
                    f.trigger === 'manual' &&
                    f.status === 'active' && (
                      <details className="mt-4 border-t border-white/10 pt-4">
                        <summary className="cursor-pointer text-sm text-[#e5a93c]">
                          Inscrever contactos nesta campanha
                        </summary>
                        <p className="my-3 text-xs leading-relaxed text-[#b4aa9c]">
                          Adiciona todos os contactos com consentimento desta
                          loja. Os já inscritos são ignorados. As mensagens
                          ficam agendadas pelos intervalos do funil.
                        </p>
                        <button
                          disabled={busy}
                          className={primaryClass}
                          onClick={() => void action('enrol', { id: f.id })}
                        >
                          Inscrever contactos e agendar
                        </button>
                      </details>
                    )}
                </article>
              ))}
            </div>
          )}
        </>
      ) : tab === 'settings' ? (
        <SettingsPanel
          key={store}
          value={data.settings}
          ownerEmail={data.ownerEmail}
          centralOwnerEmail={data.centralOwnerEmail}
          onOwnerSave={(email) => action('owner', { email })}
          busy={busy}
          onSave={(value) => action('settings', value)}
          onVerify={() => action('verify', {})}
        />
      ) : tab === 'contacts' ? (
        <ContactsPanel
          contacts={data.contacts}
          total={data.contactCount}
          busy={busy}
          onSave={(v) => action('contact', v)}
          onCancel={(id) => action('cancel_contact', { id })}
        />
      ) : (
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold">Histórico de envios</h2>
              <p className="text-sm text-[#b4aa9c]">
                {data.jobCount} mensagens · Horários de Maputo. “Aceite” não
                confirma leitura ou entrega na caixa.
              </p>
            </div>
            <button className={buttonClass} onClick={() => void load()}>
              Actualizar
            </button>
          </div>
          <h3 className="font-bold">
            Emails do sistema ? {data.deliveryCount}
          </h3>
          <p className="text-xs text-[#b4aa9c]">
            Registo a partir da ligação ao módulo. Emails globais aparecem na
            loja {data.globalStoreName}.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm text-left">
              <thead className="bg-white/5">
                <tr>
                  {['Email', 'Destinatário', 'Estado', 'Data'].map((h) => (
                    <th key={h} className="p-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.delivery.map((d) => (
                  <tr key={d.id} className="border-t border-white/10">
                    <td className="p-3">{d.event}</td>
                    <td className="p-3">{d.recipient}</td>
                    <td className="p-3">{statuses[d.status]}</td>
                    <td className="p-3">{date(d.created_at)}</td>
                  </tr>
                ))}
                {!data.delivery.length && (
                  <tr>
                    <td className="p-5 text-[#b4aa9c]" colSpan={4}>
                      Ainda sem novos envios operacionais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <h3 className="font-bold">Sequências e campanhas</h3>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-[#b4aa9c]">
                <tr>
                  {[
                    'Destinatário',
                    'Etapa',
                    'Estado',
                    'Envio / agendamento',
                    'Detalhe',
                  ].map((x) => (
                    <th key={x} className="p-4 font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.id} className="border-t border-white/10">
                    <td className="p-4">{j.recipient}</td>
                    <td className="p-4">{j.step_index + 1}</td>
                    <td className="p-4">{statuses[j.status]}</td>
                    <td className="p-4 whitespace-nowrap">
                      {date(j.sent_at ?? j.due_at)}
                    </td>
                    <td className="p-4 text-[#b4aa9c]">{j.error ?? '—'}</td>
                  </tr>
                ))}
                {data.jobs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-[#b4aa9c]">
                      Ainda não há mensagens na fila.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data && !editor && (tab === 'contacts' || tab === 'history') && (
        <div className="flex items-center justify-end gap-3 text-sm">
          <button
            disabled={offset === 0}
            className={buttonClass}
            onClick={() => setOffset((x) => Math.max(0, x - 50))}
          >
            Anterior
          </button>
          <span>Página {offset / 50 + 1}</span>
          <button
            disabled={
              offset + 50 >=
              (tab === 'contacts'
                ? data.contactCount
                : Math.max(data.jobCount, data.deliveryCount))
            }
            className={buttonClass}
            onClick={() => setOffset((x) => x + 50)}
          >
            Seguinte
          </button>
        </div>
      )}
    </div>
  );
}
