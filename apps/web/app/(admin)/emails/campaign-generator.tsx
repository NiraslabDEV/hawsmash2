'use client';
import { useEffect, useRef, useState } from 'react';
import {
  CAMPAIGN_JSON_SCHEMA,
  campaignPrompt,
  campaignToFlow,
  generatedCampaignSchema,
} from '@/lib/email/campaign-skill';
import type { EmailFlow } from '@/lib/email/studio';
import { buttonClass, fieldClass, primaryClass } from './shared';

export function CampaignGenerator({
  brand,
  knowledge,
  onKnowledgeSave,
  onGenerated,
}: {
  brand: { name: string; store: string; tagline?: string };
  knowledge: string;
  onKnowledgeSave: (notes: string) => Promise<unknown>;
  onGenerated: (flow: EmailFlow) => void;
}) {
  const [open, setOpen] = useState(false),
    [objective, setObjective] = useState('Trazer clientes de volta à loja'),
    [audience, setAudience] = useState(
      'Clientes que aceitaram receber novidades',
    ),
    [offer, setOffer] = useState(''),
    [notes, setNotes] = useState(knowledge),
    [count, setCount] = useState(3),
    [progress, setProgress] = useState(''),
    [error, setError] = useState(''),
    [running, setRunning] = useState(false),
    [result, setResult] = useState<{
      flow: EmailFlow;
      strategy: string;
    } | null>(null);
  const worker = useRef<Worker | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
    },
    [],
  );
  function cancel() {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    setProgress('Geração cancelada.');
  }
  async function generate() {
    setError('');
    setResult(null);
    if (!('gpu' in navigator)) {
      setError(
        'Este navegador não suporta WebGPU. Abre esta página no Chrome ou Edge num computador compatível. Podes usar os 12 modelos sem IA.',
      );
      return;
    }
    if (!objective.trim()) {
      setError('Define o objectivo da campanha.');
      return;
    }
    const current = ++generation.current;
    setRunning(true);
    setProgress('A preparar o modelo…');
    try {
      const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
      if (current !== generation.current) return;
      worker.current = new Worker(
        new URL('./campaign-worker.ts', import.meta.url),
        { type: 'module' },
      );
      const engine = await CreateWebWorkerMLCEngine(
        worker.current,
        'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
        {
          initProgressCallback: (p) => {
            if (current === generation.current) setProgress(p.text);
          },
        },
        { context_window_size: 8192 },
      );
      if (current !== generation.current) return;
      setProgress('A escrever a sequência no teu computador…');
      const prompt = campaignPrompt({
        objective,
        audience,
        offer,
        notes,
        count,
        brand,
      });
      const response = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: 0.6,
        max_tokens: 2200,
        response_format: {
          type: 'json_object',
          schema: JSON.stringify({
            ...CAMPAIGN_JSON_SCHEMA,
            properties: {
              ...CAMPAIGN_JSON_SCHEMA.properties,
              steps: {
                ...CAMPAIGN_JSON_SCHEMA.properties.steps,
                minItems: count,
                maxItems: count,
              },
            },
          }),
        },
      });
      if (current !== generation.current) return;
      const parsed = generatedCampaignSchema.parse(
        JSON.parse(response.choices[0]?.message.content ?? ''),
      );
      if (parsed.steps.length !== count) throw new Error('count');
      setResult({ flow: campaignToFlow(parsed), strategy: parsed.strategy });
      setProgress(
        'Rascunho gerado. Revê a oferta e os textos antes de activar.',
      );
      await engine.unload();
    } catch {
      if (current === generation.current)
        setError(
          'Não foi possível gerar um rascunho válido. Verifica a ligação, a memória gráfica e a aceleração de hardware; tenta novamente ou parte de um modelo da biblioteca.',
        );
    } finally {
      if (current === generation.current) {
        worker.current?.terminate();
        worker.current = null;
        setRunning(false);
      }
    }
  }
  return (
    <section className="rounded-2xl border border-[#e5a93c]/25 bg-[#e5a93c]/5 p-5 space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Estúdio de campanhas com IA</h2>
          <p className="mt-1 text-sm text-[#b4aa9c]">
            Objectivo, oferta e conhecimento da tua marca → sequência pronta a
            editar.
          </p>
        </div>
        <button className={buttonClass} onClick={() => setOpen(!open)}>
          {open ? 'Recolher' : 'Criar com IA gratuita'}
        </button>
      </div>
      {open && (
        <>
          <p className="text-xs leading-relaxed text-[#b4aa9c]">
            IA local Qwen / WebLLM, sem subscrição nem chave. O primeiro uso
            descarrega cerca de 1 GB e requer WebGPU e memória gráfica
            disponível. Os textos são gerados neste computador. Nenhum contacto
            é enviado ao modelo.
          </p>
          <fieldset disabled={running} className="grid gap-4 md:grid-cols-2">
            <label className="text-sm space-y-2">
              <span>Objectivo</span>
              <input
                className={fieldClass}
                value={objective}
                maxLength={500}
                onChange={(e) => setObjective(e.target.value)}
              />
            </label>
            <label className="text-sm space-y-2">
              <span>Público</span>
              <input
                className={fieldClass}
                value={audience}
                maxLength={500}
                onChange={(e) => setAudience(e.target.value)}
              />
            </label>
            <label className="text-sm space-y-2 md:col-span-2">
              <span>Oferta e condições confirmadas</span>
              <textarea
                className={fieldClass}
                rows={2}
                value={offer}
                maxLength={2000}
                placeholder="Produto, benefício, datas e condições. Deixa vazio para uma campanha sem desconto."
                onChange={(e) => setOffer(e.target.value)}
              />
            </label>
            <label className="text-sm space-y-2 md:col-span-2">
              <span>Conhecimento da marca e orientações</span>
              <textarea
                className={fieldClass}
                rows={4}
                value={notes}
                maxLength={6000}
                placeholder="Tom de voz, produtos, diferenciais, termos a evitar e factos que a IA pode usar."
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-3 items-center">
              <button
                className={buttonClass}
                onClick={() => void onKnowledgeSave(notes)}
              >
                Guardar conhecimento da loja
              </button>
              <label className="flex items-center gap-2 text-sm">
                Emails
                <select
                  className={fieldClass}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {[2, 3, 4, 5].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
          <details className="text-xs text-[#b4aa9c]">
            <summary className="cursor-pointer">
              Conhecimento de campanhas incluído
            </summary>
            <p className="mt-2 leading-relaxed">
              Uma intenção e um botão por email; sequência de apresentação,
              benefício e lembrete; assunto curto e preheader complementar;
              intervalos após o envio anterior; português de Portugal;
              consentimento e cancelamento de subscrição; sem inventar
              descontos, produtos, testemunhos ou urgência. Marca ligada:{' '}
              {brand.name} · {brand.store}.
            </p>
          </details>
          <div className="flex gap-3">
            <button
              disabled={running}
              className={primaryClass}
              onClick={() => void generate()}
            >
              {running ? 'A gerar…' : 'Gerar novo funil'}
            </button>
            {running && (
              <button className={buttonClass} onClick={cancel}>
                Cancelar geração
              </button>
            )}
          </div>
          {progress && (
            <p role="status" className="text-xs break-words text-[#b4aa9c]">
              {progress}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          {result && (
            <div className="rounded-xl bg-black/20 p-4 space-y-3">
              <h3 className="font-bold">{result.flow.name}</h3>
              <p className="text-sm text-[#b4aa9c]">{result.strategy}</p>
              <ol className="list-decimal pl-5 text-sm space-y-2">
                {result.flow.steps.map((s, i) => (
                  <li key={i}>
                    {s.subject} · {s.delay_minutes} min após{' '}
                    {i ? 'o envio anterior' : 'a inscrição'}
                  </li>
                ))}
              </ol>
              <button
                className={primaryClass}
                onClick={() => onGenerated(result.flow)}
              >
                Rever e editar rascunho
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
