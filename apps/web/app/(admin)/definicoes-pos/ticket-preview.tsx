'use client';

/**
 * O talão no ecrã, a partir das MESMAS instruções que o mini-PC imprime
 * (`@delivery/receipt`: buildFullTicket → renderPreview). Papel de 80 mm:
 * 48 colunas em letra normal; a dobrar ocupa o dobro da largura.
 *
 * O logo e o QR são marcas: o logo é um ficheiro do mini-PC (sai se a
 * instalação o tiver), e o QR é desenhado pelo firmware da impressora.
 */

import type { CSSProperties } from 'react';
import type { PreviewLine, PreviewSpan } from '@delivery/receipt';

const SPAN_STYLE: Record<PreviewSpan['size'], CSSProperties> = {
  normal: {},
  // Só a altura a dobrar: mantém as 48 colunas.
  tall: { display: 'inline-block', transform: 'scaleY(1.8)', transformOrigin: 'center', margin: '0.35em 0' },
  double: { fontSize: '2em', lineHeight: 1.15 },
  triple: { fontSize: '3em', lineHeight: 1.1 },
};

export function TicketPreview({
  lines,
  brandName,
  logoUrl,
}: {
  lines: PreviewLine[];
  brandName: string;
  logoUrl?: string | null;
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-black/30 p-3">
      <div
        className="mx-auto rounded-sm bg-[#fbfaf6] px-[1.5ch] py-4 font-mono text-[#141414] shadow-[0_12px_30px_rgba(0,0,0,.45)]"
        style={{ width: 'calc(48ch + 3ch)', fontSize: '11px', lineHeight: 1.35 }}
        aria-label="Pré-visualização do talão"
      >
        {lines.map((linha, indice) => {
          if (linha.kind === 'blank') return <div key={indice} style={{ height: '1.35em' }} />;
          if (linha.kind === 'cut') {
            return (
              <div key={indice} className="mt-1 border-t border-dashed border-[#9a9a9a] pt-1 text-center text-[10px] text-[#8a8a8a]">
                ✂ corte
              </div>
            );
          }
          if (linha.kind === 'brand') {
            return (
              <div key={indice} className="my-1 flex flex-col items-center gap-1">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-14 w-auto object-contain grayscale" />
                ) : (
                  <span className="text-[2.2em] font-black uppercase">{brandName}</span>
                )}
                <span className="text-[9px] text-[#8a8a8a]">logo do mini-PC (se a instalação o tiver)</span>
              </div>
            );
          }
          if (linha.kind === 'qr') {
            return (
              <div key={indice} className={`my-1 flex ${linha.align === 'center' ? 'justify-center' : ''}`}>
                <span
                  className="grid h-20 w-20 place-items-center border-4 border-double border-[#141414] text-[9px] font-bold"
                  title={linha.data}
                >
                  QR
                </span>
              </div>
            );
          }
          return (
            <div key={indice} style={{ textAlign: linha.align, whiteSpace: 'pre', minHeight: '1.35em' }}>
              {linha.spans.map((span, i) => (
                <span key={i} style={{ fontWeight: span.bold ? 800 : 400, ...SPAN_STYLE[span.size] }}>
                  {span.text}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
