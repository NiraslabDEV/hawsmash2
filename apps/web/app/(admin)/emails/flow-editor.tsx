'use client';
import { useState } from 'react';
import { TemplatePicker } from './template-picker';
import { applyLibraryTemplate } from '@/lib/email/template-library';
import {
  defaultStep,
  renderMessage,
  triggerLabels,
  type EmailBlock,
  type EmailFlow,
} from '@/lib/email/studio';
import { buttonClass, fieldClass, primaryClass } from './shared';

const blockLabels = {
  heading: 'Título',
  text: 'Texto',
  image: 'Imagem',
  button: 'Botão',
  divider: 'Separador',
  system: 'Dados do sistema',
};
export function FlowEditor({
  value,
  onChange,
  onSave,
  onClose,
  busy,
  storeName,
  operational,
}: {
  value: EmailFlow;
  onChange: (value: EmailFlow) => void;
  onSave: () => void;
  onClose: () => void;
  busy: boolean;
  storeName: string;
  operational?: { subject: string; html: string };
}) {
  const [selected, setSelected] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [unit, setUnit] = useState(1);
  const step = value.steps[selected];
  const changeStep = (patch: Partial<typeof step>) =>
    onChange({
      ...value,
      steps: value.steps.map((s, i) =>
        i === selected ? { ...s, ...patch } : s,
      ),
    });
  const changeBlock = (index: number, block: EmailBlock) =>
    changeStep({
      blocks: step.blocks.map((b, i) => (i === index ? block : b)),
    });
  const preview = renderMessage(
    step,
    {
      nome: 'Cliente',
      loja: storeName,
      pedido: 'EXEMPLO',
      total: '450 MT',
      assunto_original: operational?.subject ?? '',
      menu_url: 'https://example.com/menu',
    },
    value.kind === 'marketing' ? 'https://example.com/cancelar' : undefined,
    operational?.html,
  );
  function addBlock(type: EmailBlock['type']) {
    const block: EmailBlock =
      type === 'divider' || type === 'system'
        ? { type }
        : type === 'button' || type === 'image'
          ? {
              type,
              text: type === 'button' ? 'Ver novidades' : 'Descrição da imagem',
              url: 'https://',
            }
          : {
              type,
              text: type === 'heading' ? 'Novo título' : 'Escreve aqui…',
            };
    changeStep({ blocks: [...step.blocks, block] });
  }
  function moveBlock(index: number, delta: number) {
    const blocks = [...step.blocks];
    [blocks[index], blocks[index + delta]] = [
      blocks[index + delta],
      blocks[index],
    ];
    changeStep({ blocks });
  }
  function moveStep(delta: number) {
    const steps = [...value.steps];
    [steps[selected], steps[selected + delta]] = [
      steps[selected + delta],
      steps[selected],
    ];
    onChange({ ...value, steps });
    setSelected(selected + delta);
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button disabled={busy} className={buttonClass} onClick={onClose}>
          ← Voltar à lista
        </button>
        <div className="flex gap-2">
          {!operational && (
            <select
              aria-label="Estado do funil"
              value={value.status}
              onChange={(e) =>
                onChange({
                  ...value,
                  status: e.target.value as EmailFlow['status'],
                })
              }
              className={fieldClass}
            >
              <option value="draft">Rascunho</option>
              <option value="active">Activo</option>
              <option value="paused">Pausado</option>
              <option value="archived">Arquivado — cancelar fila</option>
            </select>
          )}
          <button
            disabled={busy}
            className={primaryClass + ' whitespace-nowrap'}
            onClick={onSave}
          >
            {busy ? 'A guardar…' : 'Guardar funil'}
          </button>
        </div>
      </div>
      {!operational && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span>Nome da sequência</span>
            <input
              className={fieldClass}
              maxLength={120}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span>Começa quando…</span>
            <select
              className={fieldClass}
              disabled={!!value.id}
              value={value.trigger}
              onChange={(e) =>
                onChange({
                  ...value,
                  trigger: e.target.value as EmailFlow['trigger'],
                })
              }
            >
              {(value.kind === 'marketing'
                ? (['manual', 'subscribed'] as const)
                : (['paid', 'ready', 'delivered', 'cancelled'] as const)
              ).map((t) => (
                <option key={t} value={t}>
                  {triggerLabels[t]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[210px_minmax(0,1fr)_minmax(300px,.85fr)]">
        <aside className="rounded-2xl border border-white/10 bg-[#1c1915] p-3 space-y-2">
          <p className="px-2 py-2 text-xs uppercase tracking-wider text-[#b4aa9c]">
            Sequência
          </p>
          {value.steps.map((s, i) => (
            <div key={i}>
              <button
                className={`w-full rounded-xl p-3 text-left focus-visible:outline focus-visible:outline-[#e5a93c] ${selected === i ? 'bg-[#e5a93c]/15 ring-1 ring-[#e5a93c]/40' : 'hover:bg-white/5'}`}
                onClick={() => {
                  setSelected(i);
                  setUnit(1);
                }}
              >
                <span className="text-xs text-[#e5a93c]">EMAIL {i + 1}</span>
                <span className="mt-1 block truncate text-sm font-semibold">
                  {s.subject}
                </span>
                <span className="mt-1 block text-xs text-[#b4aa9c]">
                  {s.delay_minutes
                    ? `Esperar ${s.delay_minutes} min`
                    : 'Sem espera'}
                </span>
              </button>
              {i < value.steps.length - 1 && (
                <div className="ml-5 h-4 border-l border-dashed border-[#e5a93c]/30" />
              )}
            </div>
          ))}
          <button
            disabled={!!operational || value.steps.length >= 12}
            className={buttonClass + ' w-full mt-3'}
            onClick={() => {
              onChange({
                ...value,
                steps: [
                  ...value.steps,
                  { ...defaultStep(), delay_minutes: 1440 },
                ],
              });
              setSelected(value.steps.length);
              setUnit(1440);
            }}
          >
            + Adicionar email
          </button>
          <p className="px-2 pt-2 text-xs leading-relaxed text-[#b4aa9c]">
            A primeira espera conta desde o evento. As seguintes contam desde o
            envio anterior.
          </p>
        </aside>
        <div className="rounded-2xl border border-white/10 bg-[#1c1915] p-4 md:p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Email {selected + 1}</h3>
            <div className="flex gap-1">
              <button
                className={buttonClass}
                disabled={selected === 0}
                aria-label="Antecipar etapa"
                onClick={() => moveStep(-1)}
              >
                ↑
              </button>
              <button
                className={buttonClass}
                disabled={selected === value.steps.length - 1}
                aria-label="Adiar etapa"
                onClick={() => moveStep(1)}
              >
                ↓
              </button>
            </div>
            <button
              disabled={value.steps.length === 1}
              onClick={() => {
                onChange({
                  ...value,
                  steps: value.steps.filter((_, i) => i !== selected),
                });
                setSelected(0);
                setUnit(1);
              }}
              className="min-h-11 text-xs text-red-300 disabled:opacity-30"
            >
              Remover etapa
            </button>
          </div>
          <label className="block space-y-2 text-sm">
            <span>Enviar após</span>
            <div className="flex gap-2">
              <input
                aria-label="Tempo de espera"
                type="number"
                disabled={!!operational}
                min={0}
                step={1}
                value={step.delay_minutes / unit}
                onChange={(e) =>
                  changeStep({
                    delay_minutes: Math.round(Number(e.target.value) * unit),
                  })
                }
                className={fieldClass}
              />
              <select
                aria-label="Unidade de tempo"
                className={fieldClass}
                value={unit}
                onChange={(e) => setUnit(Number(e.target.value))}
              >
                <option value={1}>minutos</option>
                <option value={60}>horas</option>
                <option value={1440}>dias</option>
              </select>
            </div>
          </label>
          <TemplatePicker
            onSelect={(id) =>
              changeStep(applyLibraryTemplate(id, step, !!operational))
            }
          />
          <label className="block space-y-2 text-sm">
            <span>Assunto</span>
            <input
              value={step.subject}
              maxLength={200}
              onChange={(e) => changeStep({ subject: e.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span>Texto de pré-visualização</span>
            <input
              value={step.preheader}
              maxLength={300}
              onChange={(e) => changeStep({ preheader: e.target.value })}
              className={fieldClass}
              placeholder="A frase que aparece ao lado do assunto"
            />
          </label>
          <div className="rounded-xl bg-white/5 p-3 text-xs leading-relaxed text-[#b4aa9c]">
            Personalização:{' '}
            <code className="text-[#e5a93c]">{'{{nome}} · {{loja}}'}</code>
            {value.kind === 'transactional' && (
              <code className="text-[#e5a93c]">
                {' · {{pedido}} · {{total}}'}
              </code>
            )}
          </div>
          <div className="space-y-3">
            {step.blocks.map((block, i) => (
              <div
                key={i}
                className="rounded-xl border border-white/10 p-3 space-y-3"
              >
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-[#b4aa9c]">
                    {blockLabels[block.type]}
                  </span>
                  <div className="flex gap-1">
                    <button
                      className="h-11 w-9 disabled:opacity-25"
                      aria-label={`Subir bloco ${i + 1}`}
                      disabled={i === 0}
                      onClick={() => moveBlock(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="h-11 w-9 disabled:opacity-25"
                      aria-label={`Descer bloco ${i + 1}`}
                      disabled={i === step.blocks.length - 1}
                      onClick={() => moveBlock(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="h-11 w-9 text-red-300 disabled:opacity-25"
                      aria-label={`Remover bloco ${i + 1}`}
                      disabled={
                        step.blocks.length === 1 || block.type === 'system'
                      }
                      onClick={() =>
                        changeStep({
                          blocks: step.blocks.filter((_, j) => j !== i),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
                {block.type === 'system' && (
                  <p className="text-xs text-[#b4aa9c]">
                    Conte?do original: pedido, c?digo ou relat?rio. Preenchido
                    automaticamente em cada envio.
                  </p>
                )}
                {block.type !== 'divider' && block.type !== 'system' && (
                  <label className="block">
                    <span className="sr-only">
                      {blockLabels[block.type]} do bloco {i + 1}
                    </span>
                    {block.type === 'text' ? (
                      <textarea
                        rows={4}
                        className={fieldClass}
                        value={block.text}
                        onChange={(e) =>
                          changeBlock(i, { ...block, text: e.target.value })
                        }
                      />
                    ) : (
                      <input
                        className={fieldClass}
                        value={block.text}
                        onChange={(e) =>
                          changeBlock(i, { ...block, text: e.target.value })
                        }
                      />
                    )}
                  </label>
                )}
                {(block.type === 'image' || block.type === 'button') && (
                  <label className="block space-y-2 text-xs text-[#b4aa9c]">
                    <span>
                      {block.type === 'image'
                        ? 'Endereço da imagem (HTTPS)'
                        : 'Destino do botão (HTTPS)'}
                    </span>
                    <input
                      type="url"
                      className={fieldClass}
                      value={block.url}
                      onChange={(e) =>
                        changeBlock(i, { ...block, url: e.target.value })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 pt-4">
            <p className="mb-3 text-xs text-[#b4aa9c]">ADICIONAR BLOCO</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(blockLabels) as EmailBlock['type'][])
                .filter((type) => type !== 'system')
                .map((type) => (
                  <button
                    key={type}
                    disabled={step.blocks.length >= 40}
                    className={buttonClass}
                    onClick={() => addBlock(type)}
                  >
                    + {blockLabels[type]}
                  </button>
                ))}
            </div>
          </div>
        </div>
        <aside className="xl:sticky xl:top-5 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-[#b4aa9c]">
              Pré-visualização
            </h3>
            <button className={buttonClass} onClick={() => setMobile(!mobile)}>
              {mobile ? 'Ver no computador' : 'Ver no telemóvel'}
            </button>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#1c1915] px-4 py-3 text-sm">
            <span className="text-[#b4aa9c]">Assunto: </span>
            {preview.subject}
          </div>
          <iframe
            title="Pré-visualização do email"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={preview.html}
            className="mx-auto h-[680px] max-w-full rounded-xl border border-white/10 bg-[#f5f4f1]"
            style={{ width: mobile ? 375 : '100%' }}
          />
          <p className="text-xs leading-relaxed text-[#b4aa9c]">
            Dados de exemplo. Guardar mudanças afecta novas inscrições;
            mensagens já na fila mantêm a versão original.
          </p>
        </aside>
      </div>
    </section>
  );
}
