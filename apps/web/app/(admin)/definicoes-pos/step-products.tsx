'use client';

/**
 * Os produtos de um passo do upsell, escolhidos loja a loja.
 *
 * Por omissão o passo oferece os marcados como upsell no Cardápio (a mesma
 * regra do POS: `cardapioStepProducts`). "Escolher para esta loja" arranca
 * dessa lista — ninguém começa do zero — e a partir daí a ordem é a da loja.
 * Uma lista vazia volta a ser "os do Cardápio": não existe passo ligado sem
 * nada para oferecer.
 */

import { useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { POS_LIMITS } from '@/lib/pos/settings';

export type PickerProduct = {
  id: string;
  name: string;
  price_cents: number;
  photo_url?: string | null;
  available?: boolean;
};

export type PickerCategory = { name: string; items: PickerProduct[] };

const mt = (value: number) => formatMT(value as Cents);

function Thumb({ src }: { src?: string | null }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/40">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" />
      )}
    </span>
  );
}

export function StepProducts({
  productIds,
  cardapioIds,
  otherStepIds,
  otherStepName,
  categories,
  onChange,
}: {
  productIds: string[];
  /** O que o Cardápio oferece hoje neste passo — ponto de partida. */
  cardapioIds: string[];
  /** Já escolhidos no outro passo: não se oferece o mesmo produto duas vezes. */
  otherStepIds: string[];
  otherStepName: string;
  categories: PickerCategory[];
  onChange: (ids: string[]) => void;
}) {
  // Aberto sem produtos só enquanto se escolhe; gravado vazio = Cardápio.
  const [aEscolher, setAEscolher] = useState(false);
  const custom = productIds.length > 0 || aEscolher;

  const porId = new Map(categories.flatMap((c) => c.items).map((item) => [item.id, item]));
  const nomes = (ids: string[]) =>
    ids.map((id) => porId.get(id)?.name).filter((nome): nome is string => !!nome);
  const doCardapio = nomes(cardapioIds);
  const noOutro = new Set(otherStepIds);
  const cheio = productIds.length >= POS_LIMITS.productsPerStep;

  function mover(indice: number, delta: -1 | 1) {
    const lista = [...productIds];
    const alvo = indice + delta;
    if (alvo < 0 || alvo >= lista.length) return;
    [lista[indice], lista[alvo]] = [lista[alvo], lista[indice]];
    onChange(lista);
  }

  function alternar(id: string) {
    if (productIds.includes(id)) onChange(productIds.filter((p) => p !== id));
    else if (!cheio) onChange([...productIds, id]);
  }

  return (
    <div className="mt-3">
      <p className="text-xs font-bold uppercase tracking-wide text-[#8b8378]">Produtos</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setAEscolher(false);
            onChange([]);
          }}
          className={`rounded-xl border px-4 py-3 text-left text-sm ${
            !custom ? 'border-[#e5a93c] bg-[#e5a93c]/10 text-white' : 'border-white/10 text-[#C9BCAC]'
          }`}
        >
          <span className="block font-bold">Os marcados no Cardápio</span>
          <span className="mt-0.5 block text-xs text-[#8b8378]">
            {doCardapio.length > 0
              ? `${doCardapio.slice(0, 4).join(', ')}${doCardapio.length > 4 ? ` +${doCardapio.length - 4}` : ''}`
              : 'Nenhum marcado — o passo salta sozinho'}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setAEscolher(true);
            // Arranca do que o Cardápio já oferecia, sem o que está no outro passo.
            if (productIds.length === 0) onChange(cardapioIds.filter((id) => !noOutro.has(id)));
          }}
          className={`rounded-xl border px-4 py-3 text-left text-sm ${
            custom ? 'border-[#e5a93c] bg-[#e5a93c]/10 text-white' : 'border-white/10 text-[#C9BCAC]'
          }`}
        >
          <span className="block font-bold">Escolher para esta loja</span>
          <span className="mt-0.5 block text-xs text-[#8b8378]">
            Quais e por que ordem aparecem no POS desta loja.
          </span>
        </button>
      </div>

      {custom && (
        <div className="mt-3 space-y-3">
          {productIds.length === 0 ? (
            <p className="rounded-xl bg-white/[0.03] px-4 py-3 text-xs text-[#8b8378]">
              Toca nos produtos abaixo. Guardar sem nenhum volta a usar os do Cardápio.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {productIds.map((id, indice) => {
                const produto = porId.get(id);
                return (
                  <li key={id} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
                    <span className="w-5 text-center text-xs font-black text-[#8b8378]">{indice + 1}</span>
                    <Thumb src={produto?.photo_url} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white">
                        {produto?.name ?? 'Produto que já não existe'}
                      </span>
                      {produto && (
                        <span className="text-xs text-[#e5a93c]">
                          {mt(produto.price_cents)}
                          {produto.available === false && (
                            <span className="ml-2 text-[#ffb0b0]">esgotado — o POS salta-o</span>
                          )}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => mover(indice, -1)}
                      disabled={indice === 0}
                      className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white disabled:opacity-30"
                      aria-label="Subir"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(indice, 1)}
                      disabled={indice === productIds.length - 1}
                      className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white disabled:opacity-30"
                      aria-label="Descer"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => alternar(id)}
                      className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white hover:bg-[#7a2b2b]"
                      aria-label={`Tirar ${produto?.name ?? 'produto'} do upsell`}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="rounded-xl border border-white/[0.06] p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Juntar produtos {cheio && `(máximo ${POS_LIMITS.productsPerStep})`}
            </p>
            <div className="mt-2 space-y-3">
              {categories.map((categoria) => (
                <div key={categoria.name}>
                  <p className="mb-1.5 text-xs font-bold text-[#C9BCAC]">{categoria.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {categoria.items.map((produto) => {
                      const escolhido = productIds.includes(produto.id);
                      const bloqueado = !escolhido && (noOutro.has(produto.id) || cheio);
                      return (
                        <button
                          key={produto.id}
                          type="button"
                          disabled={bloqueado}
                          onClick={() => alternar(produto.id)}
                          title={noOutro.has(produto.id) ? `Já está em ${otherStepName}` : undefined}
                          className={`rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                            escolhido
                              ? 'bg-[#e5a93c] text-black'
                              : 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
                          }`}
                        >
                          {escolhido ? '✓ ' : ''}
                          {produto.name}
                          {noOutro.has(produto.id) && !escolhido ? ` · ${otherStepName}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
