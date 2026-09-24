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
import { noteHasChip, toggleNoteChip } from '@/lib/pos/notes';

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
    <div className="pos-screen fixed inset-0 z-[80] flex flex-col !bg-[rgba(8,7,6,.97)] p-4">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
        <p className="pos-eyebrow !text-gold">
          {label.toUpperCase()}
        </p>

        <div className="pos-well mt-2 !min-h-20 !px-5 !py-4 !shadow-[inset_0_0_0_1.5px_var(--pos-accent-line)]">
          <p className="break-words text-3xl font-semibold tracking-tight text-ink">
            {draft || <span className="text-ink-mute">…</span>}
            <span className="ml-0.5 animate-pulse text-gold">|</span>
          </p>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {/* Somam-se ao que já está escrito (e tiram-se com outro toque):
                "sem cebola" e "sem molho" são o mesmo pedido, não um ou outro. */}
            {suggestions.map((sugestao) => {
              const escolhida = noteHasChip(draft, sugestao);
              return (
                <button
                  key={sugestao}
                  type="button"
                  aria-pressed={escolhida}
                  onClick={() => {
                    setDraft((actual) => toggleNoteChip(actual, sugestao).slice(0, maxLength));
                    setCaps(false);
                  }}
                  className="pos-choice !min-h-14 shrink-0 !rounded-full !px-5 !text-base"
                >
                  {escolhida ? `✓ ${sugestao}` : sugestao}
                </button>
              );
            })}
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
                  className="pos-key flex-1 !rounded-xl !text-2xl"
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
                aria-pressed={caps}
                onClick={() => setCaps((actual) => !actual)}
                className="pos-choice flex-1 !rounded-xl !text-base !tracking-wide"
              >
                MAIÚSC
              </button>
            )}
            <button
              type="button"
              onClick={() => escrever(' ')}
              className="pos-key flex-[3] !rounded-xl !text-base !tracking-[0.2em] !text-ink-dim"
            >
              ESPAÇO
            </button>
            <button
              type="button"
              onClick={() => setDraft((actual) => actual.slice(0, -1))}
              className="pos-key pos-key--muted flex-1 !rounded-xl !text-2xl"
            >
              ⌫
            </button>
          </div>

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="pos-btn pos-btn--quiet pos-btn--lg flex-1 !text-lg"
            >
              CANCELAR
            </button>
            <button
              type="button"
              onClick={() => setDraft('')}
              className="pos-btn pos-btn--lg flex-1 !text-lg"
            >
              LIMPAR
            </button>
            <button
              type="button"
              onClick={() => onConfirm(draft.trim())}
              className="pos-btn pos-btn--primary pos-btn--lg flex-[2] !text-2xl"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
