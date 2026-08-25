'use client';

/**
 * O teclado do balcão.
 *
 * O POS corre num PC táctil sem teclado físico, e o Windows 10 em modo desktop
 * **não abre** o teclado de toque sozinho — quem estava ao balcão não conseguia
 * escrever o nome de um cliente de entrega. Depender de uma definição do
 * sistema operativo num PC de loja é exactamente o género de coisa que gera um
 * telefonema ao sábado à noite: o POS traz o seu.
 *
 * É um painel de ecrã inteiro, e não um teclado colado ao fundo, de propósito:
 * assim não há campo escondido por baixo do teclado, não há scroll a saltar, e
 * o que se está a escrever aparece em corpo grande — legível de pé, a um metro
 * do ecrã, que é a distância a que se atende.
 */

import { useEffect, useState } from 'react';

const LINHAS_TEXTO = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ç'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', 'á', 'é', 'í'],
];

const LINHAS_TELEFONE = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['+', '0', ' '],
];

export type TouchKeyboardProps = {
  /** O que se está a preencher: "Nome do cliente", "Morada". */
  label: string;
  value: string;
  mode?: 'text' | 'tel';
  /** Sugestões de um toque. No balcão poupam mais tempo do que o teclado todo. */
  suggestions?: string[];
  maxLength?: number;
  onCancel: () => void;
  onConfirm: (value: string) => void;
};

export function TouchKeyboard({
  label,
  value,
  mode = 'text',
  suggestions = [],
  maxLength = 300,
  onCancel,
  onConfirm,
}: TouchKeyboardProps) {
  const [draft, setDraft] = useState(value);
  const [caps, setCaps] = useState(value.trim().length === 0);

  // O PC de balcão pode ter teclado ligado por USB — e quem o tem quer usá-lo.
  // O teclado no ecrã não o substitui, acrescenta-se-lhe.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter') onConfirm(draft.trim());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, onCancel, onConfirm]);

  function escrever(tecla: string) {
    setDraft((actual) => {
      if (actual.length >= maxLength) return actual;
      return actual + (caps ? tecla.toUpperCase() : tecla);
    });
    if (caps && mode === 'text') setCaps(false);
  }

  const linhas = mode === 'tel' ? LINHAS_TELEFONE : LINHAS_TEXTO;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/90 p-4">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
        <p className="text-sm font-black tracking-[0.2em] text-[#e5a93c]">
          {label.toUpperCase()}
        </p>

        <div className="mt-2 min-h-20 rounded-2xl border border-white/15 bg-[#151310] px-5 py-4">
          <p className="break-words text-3xl font-black text-white">
            {draft || <span className="text-[#57514a]">…</span>}
            <span className="ml-0.5 animate-pulse text-[#e5a93c]">|</span>
          </p>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {suggestions.map((sugestao) => (
              <button
                key={sugestao}
                type="button"
                onClick={() => setDraft(sugestao)}
                className="min-h-14 shrink-0 rounded-xl bg-white/[0.08] px-4 text-base font-bold text-[#c8bfb0] active:bg-white/20"
              >
                {sugestao}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-1 flex-col justify-end gap-2">
          {linhas.map((linha, indice) => (
            <div key={indice} className="flex justify-center gap-2">
              {linha.map((tecla) => (
                <button
                  key={tecla}
                  type="button"
                  onClick={() => escrever(tecla)}
                  className="min-h-16 flex-1 rounded-xl bg-white/[0.09] text-2xl font-black text-white active:bg-white/25"
                >
                  {tecla === ' ' ? '␣' : caps && mode === 'text' ? tecla.toUpperCase() : tecla}
                </button>
              ))}
            </div>
          ))}

          <div className="flex justify-center gap-2">
            {mode === 'text' && (
              <button
                type="button"
                onClick={() => setCaps((actual) => !actual)}
                className={`min-h-16 flex-1 rounded-xl text-lg font-black active:scale-[0.98] ${
                  caps ? 'bg-[#e5a93c] text-black' : 'bg-white/[0.09] text-white'
                }`}
              >
                MAIÚSC
              </button>
            )}
            <button
              type="button"
              onClick={() => escrever(' ')}
              className="min-h-16 flex-[3] rounded-xl bg-white/[0.09] text-lg font-black text-white active:bg-white/25"
            >
              ESPAÇO
            </button>
            <button
              type="button"
              onClick={() => setDraft((actual) => actual.slice(0, -1))}
              className="min-h-16 flex-1 rounded-xl bg-white/[0.09] text-2xl font-black text-white active:bg-white/25"
            >
              ⌫
            </button>
          </div>

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-20 flex-1 rounded-2xl bg-white/[0.08] text-xl font-black text-[#c8bfb0] active:bg-white/20"
            >
              CANCELAR
            </button>
            <button
              type="button"
              onClick={() => setDraft('')}
              className="min-h-20 flex-1 rounded-2xl bg-white/[0.08] text-xl font-black text-[#c8bfb0] active:bg-white/20"
            >
              LIMPAR
            </button>
            <button
              type="button"
              onClick={() => onConfirm(draft.trim())}
              className="min-h-20 flex-[2] rounded-2xl bg-[#e5a93c] text-2xl font-black text-black active:scale-[0.98]"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
