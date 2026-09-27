'use client';
import { useState } from 'react';
import {
  SYSTEM_EMAILS,
  applySystemTemplate,
  systemTemplateSchema,
  type SystemTemplate,
  type SystemEmailKey,
} from '@/lib/email/system-catalog';
import { FlowEditor } from './flow-editor';
import { buttonClass, primaryClass } from './shared';
import type { EmailFlow } from '@/lib/email/studio';

export function SystemPanel({
  templates,
  previews,
  storeName,
  globalStoreName,
  flows,
  busy,
  onSave,
  onOpenFlow,
}: {
  templates: SystemTemplate[];
  previews: Record<SystemEmailKey, { subject: string; html: string }>;
  storeName: string;
  globalStoreName: string;
  flows: EmailFlow[];
  busy: boolean;
  onSave: (v: SystemTemplate) => Promise<unknown>;
  onOpenFlow: (f: EmailFlow) => void;
}) {
  const [editing, setEditing] = useState<SystemTemplate | null>(null);
  const [custom, setCustom] = useState(false);
  if (editing) {
    const item = SYSTEM_EMAILS.find((e) => e.key === editing.key)!;
    const valid = systemTemplateSchema.safeParse(editing);
    const preview = valid.success
      ? applySystemTemplate(editing, previews[editing.key], {
          loja: storeName,
          nome: 'Cliente de exemplo',
          pedido: 'EXEMPLO',
          total: '450 MT',
        })
      : previews[editing.key];
    return (
      <section className="rounded-2xl border border-[#e5a93c]/30 bg-[#1c1915] p-5 space-y-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{item.name}</h2>
            <p className="text-sm text-[#b4aa9c]">
              {item.when}
              {item.scope === 'global'
                ? ` · Partilhado por todas as lojas (${globalStoreName})`
                : ''}
            </p>
          </div>
          <button
            className={buttonClass}
            onClick={() => {
              setEditing(null);
              setCustom(false);
            }}
          >
            Fechar email
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className={editing.mode === 'current' ? primaryClass : buttonClass}
            onClick={() => {
              setEditing({ ...editing, mode: 'current' });
              setCustom(false);
            }}
          >
            Usar modelo actual
          </button>
          <button
            className={editing.mode === 'custom' ? primaryClass : buttonClass}
            onClick={() => {
              setEditing({ ...editing, mode: 'custom' });
              setCustom(true);
            }}
          >
            Personalizar / escolher outro modelo
          </button>
          {item.key !== 'account_code' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) =>
                  setEditing({ ...editing, enabled: e.target.checked })
                }
              />
              Envio activo
            </label>
          )}
        </div>
        {custom ? (
          <FlowEditor
            key={editing.key}
            value={{
              name: item.name,
              kind: 'transactional',
              trigger: 'paid',
              status: 'draft',
              steps: [editing.step],
            }}
            onChange={(f) =>
              setEditing({ ...editing, mode: 'custom', step: f.steps[0] })
            }
            onClose={() => setCustom(false)}
            onSave={async () => {
              if (await onSave(editing)) {
                setEditing(null);
                setCustom(false);
              }
            }}
            busy={busy}
            storeName={storeName}
            operational={previews[editing.key]}
          />
        ) : (
          <>
            <p className="text-xs text-[#b4aa9c]">
              Pré-visualização com dados de demonstração. O código 000000 é
              apenas um exemplo.
            </p>
            <p className="text-sm">{preview.subject}</p>
            <iframe
              title="Modelo actual do email"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={preview.html}
              className="w-full max-w-3xl h-[600px] bg-white text-black rounded-xl"
            />
            <button
              disabled={busy}
              className={primaryClass}
              onClick={async () => {
                if (await onSave(editing)) setEditing(null);
              }}
            >
              Guardar escolha
            </button>
          </>
        )}
      </section>
    );
  }
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Emails que o sistema já envia</h2>
        <p className="mt-1 text-sm text-[#b4aa9c]">
          Os nove emails existentes estão ligados a estas configurações. Mantém
          o modelo actual ou personaliza os blocos.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SYSTEM_EMAILS.map((item) => {
          const config = templates.find((t) => t.key === item.key)!;
          const sequence = flows.find(
            (f) =>
              f.kind === 'transactional' &&
              f.trigger === item.key &&
              ['active', 'paused'].includes(f.status),
          );
          return (
            <article
              key={item.key}
              className="rounded-2xl border border-white/10 bg-[#1c1915] p-5"
            >
              <div className="flex justify-between gap-2 text-xs">
                <span className="text-[#e5a93c]">
                  {item.audience} ·{' '}
                  {item.scope === 'global' ? 'Todas as lojas' : 'Esta loja'}
                </span>
                <span className="text-[#b4aa9c]">
                  {sequence
                    ? 'Usa sequência'
                    : !config.enabled
                      ? 'Desligado'
                      : config.mode === 'current'
                        ? 'Modelo actual'
                        : 'Personalizado'}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold">{item.name}</h3>
              <p className="mt-2 text-xs text-[#e5a93c]">{item.when}</p>
              <p className="mt-3 text-sm text-[#b4aa9c]">{item.description}</p>
              <button
                className={buttonClass + ' mt-4'}
                onClick={() =>
                  sequence
                    ? onOpenFlow(structuredClone(sequence))
                    : setEditing(structuredClone(config))
                }
              >
                {sequence ? 'Editar sequência associada' : 'Ver e personalizar'}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
