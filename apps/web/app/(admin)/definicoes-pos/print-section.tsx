'use client';

/**
 * Impressão — como sai o talão de cada pedido nesta loja.
 *
 * Três coisas, e só três, de propósito (ADR 0007):
 * - quantas vias (`stores.kitchen_ticket_copies`, 1071 — a base de dados lê-o
 *   ao criar os trabalhos de impressão);
 * - o modelo de cada via (Completo, Compacto, Cozinha);
 * - os blocos do modelo Completo (logo, morada, agradecimento, QR, rodapé,
 *   letra dos artigos).
 *
 * Os modelos são desenhados e testados em `@delivery/receipt`; não há editor
 * livre, porque um talão mal feito é uma cozinha sem papel. A pré-visualização
 * usa as mesmas instruções que o mini-PC imprime.
 */

import { useMemo, useState } from 'react';
import {
  TICKET_TEMPLATES,
  TICKET_VIAS,
  buildFullTicket,
  renderPreview,
  sampleTicket,
  type PrintLayout,
  type SampleItem,
  type TicketTemplate,
  type TicketVia,
  type TicketViaLabel,
} from '@delivery/receipt';

import type { PosUpsellCategory } from '@/lib/pos/pos-upsell';

import { TicketPreview } from './ticket-preview';

export type PrintStoreInfo = {
  short_name: string;
  address: string | null;
  phone: string | null;
  receipt_footer: string | null;
};

export type PrintBrandInfo = {
  name: string;
  logoUrl: string | null;
  reviewUrl: string | null;
  instagram: string | null;
  instagramUrl: string | null;
};

const VIAS_POR_COPIAS: Record<number, TicketVia[]> = {
  1: ['controlo'],
  2: ['controlo', 'cliente'],
  3: ['controlo', 'cliente', 'cozinha'],
};

const COPIAS_TEXTO: Record<number, string> = {
  1: 'Um talão só, sem rótulo, na impressora da cozinha.',
  2: 'Via de controlo no balcão + via do cliente na cozinha (o saco).',
  3: 'As duas + uma via que fica na cozinha.',
};

const TIPOS = [
  { id: 'delivery', label: 'Entrega' },
  { id: 'pickup', label: 'Levantamento' },
  { id: 'counter', label: 'Balcão' },
] as const;

const DETALHES: Array<{ key: keyof PrintLayout['show'] | 'bigItems'; label: string; hint: string }> = [
  { key: 'logo', label: 'Logo no topo', hint: 'O ficheiro do logo do mini-PC; sem ele sai o nome da marca.' },
  { key: 'storeContacts', label: 'Morada e telefone da loja', hint: 'Por baixo do nome da loja (aba Lojas).' },
  { key: 'bigItems', label: 'Artigos em letra alta', hint: 'Lêem-se de relance; gasta um pouco mais de papel.' },
  { key: 'thanks', label: 'Agradecimento com o nome do cliente', hint: '"Obrigado! Bom apetite, Maria!"' },
  { key: 'qr', label: 'QR de avaliação (ou Instagram)', hint: 'O link vem da aba Aparência.' },
  { key: 'footer', label: 'Rodapé da loja', hint: 'O texto do rodapé da aba Lojas (ex.: NUIT).' },
];

/** Artigos de verdade da loja no exemplo: um de cada uma das primeiras categorias. */
function artigosDaLoja(categorias: PosUpsellCategory[] | null): SampleItem[] | undefined {
  if (!categorias) return undefined;
  const escolhidos = categorias
    .map((categoria) => categoria.items.find((item) => item.available !== false) ?? categoria.items[0])
    .filter((item): item is NonNullable<typeof item> => !!item)
    .slice(0, 3);
  if (escolhidos.length === 0) return undefined;
  return escolhidos.map((item, indice) => ({
    name: item.name,
    quantity: indice === 1 ? 1 : 2,
    unitPriceCents: item.price_cents,
    notes: indice === 0 ? 'SEM CEBOLA, SEM MOLHO' : null,
  }));
}

export function PrintSection({
  printing,
  onChange,
  copies,
  onCopiesChange,
  store,
  brand,
  categories,
}: {
  printing: PrintLayout;
  onChange: (next: PrintLayout) => void;
  copies: number;
  onCopiesChange: (next: number) => void;
  store: PrintStoreInfo;
  brand: PrintBrandInfo;
  categories: PosUpsellCategory[] | null;
}) {
  const vias = VIAS_POR_COPIAS[copies] ?? VIAS_POR_COPIAS[2];
  const [previewVia, setPreviewVia] = useState<TicketVia>('controlo');
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]['id']>('delivery');
  const viaMostrada = vias.includes(previewVia) ? previewVia : vias[0];
  // Com uma via só o talão não leva rótulo; a via única usa o modelo da de controlo.
  const rotulo: TicketViaLabel | null = copies === 1 ? null : viaMostrada;

  const linhas = useMemo(() => {
    const pedido = sampleTicket({
      store: {
        shortName: store.short_name,
        address: store.address,
        phone: store.phone,
        footer: store.receipt_footer,
        reviewUrl: brand.reviewUrl,
        instagram: brand.instagram,
        instagramUrl: brand.instagramUrl,
      },
      via: rotulo,
      fulfillment: tipo,
      items: artigosDaLoja(categories),
    });
    return renderPreview(buildFullTicket(pedido, printing));
  }, [brand, categories, printing, rotulo, store, tipo]);

  const usaCompleto = vias.some((via) => printing.templates[via] === 'completo');

  return (
    <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#8b8378]">Vias por pedido</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onCopiesChange(n)}
                className={`rounded-xl border px-3 py-3 text-lg font-black ${
                  copies === n ? 'border-[#e5a93c] bg-[#e5a93c]/10 text-white' : 'border-white/10 text-[#C9BCAC]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-[#8b8378]">{COPIAS_TEXTO[copies]}</p>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#8b8378]">Modelo de cada via</p>
          <div className="mt-2 space-y-2">
            {vias.map((via) => (
              <div key={via} className="rounded-xl bg-white/[0.03] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-bold text-white">
                      {copies === 1 ? 'Via única' : TICKET_VIAS[via].name}
                    </span>
                    <span className="block text-xs text-[#8b8378]">
                      {copies === 1 ? 'Sai na impressora da cozinha, sem rótulo.' : TICKET_VIAS[via].where}
                    </span>
                  </span>
                  <div className="flex gap-1.5">
                    {(Object.keys(TICKET_TEMPLATES) as TicketTemplate[]).map((modelo) => (
                      <button
                        key={modelo}
                        type="button"
                        onClick={() => {
                          onChange({ ...printing, templates: { ...printing.templates, [via]: modelo } });
                          setPreviewVia(via);
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                          printing.templates[via] === modelo
                            ? 'bg-[#e5a93c] text-black'
                            : 'bg-white/[0.07] text-[#C9BCAC] hover:bg-white/[0.12]'
                        }`}
                      >
                        {TICKET_TEMPLATES[modelo].name}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-[#C9BCAC]">{TICKET_TEMPLATES[printing.templates[via]].description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={usaCompleto ? '' : 'opacity-50'}>
          <p className="text-xs font-bold uppercase tracking-wide text-[#8b8378]">
            Detalhes do modelo Completo {usaCompleto ? '' : '— nenhuma via o usa'}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {DETALHES.map((detalhe) => {
              const ligado = detalhe.key === 'bigItems' ? printing.bigItems : printing.show[detalhe.key];
              return (
                <label
                  key={detalhe.key}
                  className="flex cursor-pointer items-start justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3"
                >
                  <span>
                    <span className="block text-sm font-bold text-white">{detalhe.label}</span>
                    <span className="mt-0.5 block text-xs text-[#8b8378]">{detalhe.hint}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={ligado}
                    onChange={(event) => {
                      const valor = event.target.checked;
                      onChange(
                        detalhe.key === 'bigItems'
                          ? { ...printing, bigItems: valor }
                          : { ...printing, show: { ...printing.show, [detalhe.key]: valor } },
                      );
                    }}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[#e5a93c]"
                  />
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="xl:w-[26rem]">
        <p className="text-xs font-bold uppercase tracking-wide text-[#8b8378]">Pré-visualização</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {vias.map((via) => (
            <button
              key={via}
              type="button"
              onClick={() => setPreviewVia(via)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                viaMostrada === via ? 'bg-white/[0.14] text-white' : 'bg-white/[0.05] text-[#8b8378]'
              }`}
            >
              {copies === 1 ? 'Via única' : TICKET_VIAS[via].name}
            </button>
          ))}
          <span className="mx-1 w-px bg-white/10" />
          {TIPOS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTipo(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                tipo === t.id ? 'bg-white/[0.14] text-white' : 'bg-white/[0.05] text-[#8b8378]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <TicketPreview lines={linhas} brandName={brand.name} logoUrl={brand.logoUrl} />
        </div>
        <p className="mt-2 text-[11px] text-[#8b8378]">
          Pedido de exemplo com os artigos desta loja. O mini-PC aplica o que guardares em até 1 minuto;
          um mini-PC com o programa antigo continua a imprimir o Completo.
        </p>
      </div>
    </div>
  );
}
