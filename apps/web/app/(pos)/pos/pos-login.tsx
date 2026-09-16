'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { createClient } from '@/utils/supabase/client';
import {
  POS_PIN_MIN,
  POS_PIN_MAX,
  appendPinDigit,
  cardInitials,
  cardState,
  lockCountdown,
  loginErrorMessage,
  roleLabel,
  type StaffCard,
} from '@/lib/pos/card-login';

type Props = {
  deviceId: string;
  /** Marca do card de quem já tem sessão aberta neste PC (ecrã bloqueado). */
  currentUserId?: string | null;
  /**
   * Desbloqueio de quem já tem sessão: mantém a sessão viva (e a fila offline
   * a sincronizar) em vez de a trocar por uma nova. Só existe no ecrã
   * bloqueado — no arranque não há sessão nenhuma para reaproveitar.
   */
  onUnlockCurrentUser?: (pin: string) => Promise<{ ok: boolean; reason?: string }>;
  /** Recebe quem entrou: o shell precisa de saber se houve troca de turno. */
  onAuthenticated: (userId: string) => void | Promise<void>;
  /** Acções do terminal (desvincular PC, entrar por email) — vivem no shell. */
  footer?: ReactNode;
};

type Estado = 'loading' | 'ready' | 'unavailable';

/**
 * Ecrã de entrada do balcão: os cards da equipa desta loja e um teclado de
 * números (CLAUDE §7.6 — touch, alvos grandes, sem teclado de texto).
 *
 * Toca-se no card e marca-se o PIN. Ninguém escreve um email num ecrã tátil
 * com fila à frente — e cada venda continua assinada por quem a fez, porque o
 * PIN abre a sessão daquela pessoa e não uma sessão do terminal (§6).
 */
export function PosLogin({
  deviceId,
  currentUserId = null,
  onUnlockCurrentUser,
  onAuthenticated,
  footer,
}: Props) {
  const supabase = createClient();
  const [estado, setEstado] = useState<Estado>('loading');
  const [storeName, setStoreName] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [cards, setCards] = useState<StaffCard[]>([]);
  const [selected, setSelected] = useState<StaffCard | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadCards = useCallback(async () => {
    setEstado('loading');
    setError(null);
    const { data, error: cardsError } = await supabase.rpc('pos_login_cards', {
      p_device_id: deviceId,
    });
    if (cardsError || !data?.ok) {
      setEstado('unavailable');
      setError(
        loginErrorMessage(
          cardsError ? 'offline' : (data?.reason ?? 'unknown'),
        ),
      );
      return;
    }
    setStoreName(data.device?.store_name ?? null);
    setDeviceLabel(data.device?.label ?? null);
    setCards((data.staff ?? []) as StaffCard[]);
    setEstado('ready');
  }, [deviceId, supabase]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const escolher = (card: StaffCard) => {
    const state = cardState(card);
    setPin('');
    if (state === 'no-pin') {
      setSelected(null);
      setError(loginErrorMessage('pin_not_configured'));
      return;
    }
    if (state === 'locked') {
      setSelected(null);
      setError(loginErrorMessage('pin_locked', card.locked_until));
      return;
    }
    setError(null);
    setSelected(card);
  };

  const submit = useCallback(async () => {
    if (!selected || pin.length < POS_PIN_MIN || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      if (currentUserId && currentUserId === selected.user_id && onUnlockCurrentUser) {
        const resultado = await onUnlockCurrentUser(pin);
        if (resultado.ok) {
          setPin('');
          setSelected(null);
          await onAuthenticated(selected.user_id);
          return;
        }
        setPin('');
        setError(loginErrorMessage(resultado.reason ?? 'invalid_pin'));
        return;
      }

      const resposta = await fetch('/api/pos/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, userId: selected.user_id, pin }),
      });
      const corpo = await resposta.json().catch(() => null);

      if (!resposta.ok || !corpo?.accessToken) {
        setPin('');
        setError(corpo?.error ?? loginErrorMessage('unknown'));
        // Um card que acabou de ficar em castigo tem de aparecer travado na
        // grelha, não só na mensagem — senão a pessoa tenta outra vez já.
        if (corpo?.reason === 'pin_locked' || corpo?.reason === 'invalid_device') {
          setSelected(null);
          void loadCards();
        }
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: corpo.accessToken,
        refresh_token: corpo.refreshToken,
      });
      if (sessionError) {
        setPin('');
        setError(loginErrorMessage('session_unavailable'));
        return;
      }

      setPin('');
      setSelected(null);
      await onAuthenticated(selected.user_id);
    } catch {
      setPin('');
      setError(loginErrorMessage('offline'));
    } finally {
      setSubmitting(false);
    }
  }, [
    currentUserId,
    deviceId,
    loadCards,
    onAuthenticated,
    onUnlockCurrentUser,
    pin,
    selected,
    submitting,
    supabase,
  ]);

  // O PC do balcão costuma ter teclado ligado mesmo sendo touch. Quem prefere
  // teclar não devia ser obrigado a apontar para o ecrã.
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') {
        setPin((actual) => appendPinDigit(actual, event.key));
      } else if (event.key === 'Backspace') {
        setPin((actual) => actual.slice(0, -1));
      } else if (event.key === 'Enter') {
        void submit();
      } else if (event.key === 'Escape') {
        setSelected(null);
        setPin('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, submit]);

  if (estado === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0a0807] text-[#e5a93c]">
        <p className="text-xl font-bold">A carregar a equipa…</p>
      </div>
    );
  }

  if (estado === 'unavailable') {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0a0807] p-6 text-white">
        <section className="w-full max-w-lg rounded-3xl border border-red-500/40 bg-red-950/30 p-8 text-center">
          <h1 className="text-2xl font-black">Entrada indisponível</h1>
          <p className="mt-3 text-red-100">{error}</p>
          <button
            type="button"
            onClick={() => void loadCards()}
            className="mt-6 min-h-16 w-full rounded-2xl bg-[#e5a93c] px-6 font-black text-black active:scale-[0.98]"
          >
            Tentar novamente
          </button>
          {footer && <div className="mt-8 border-t border-white/10 pt-5 text-left">{footer}</div>}
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0807] p-4 text-[#f6f1e6] sm:p-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="text-center">
          <p className="text-sm font-black tracking-[0.2em] text-[#e5a93c]">
            {currentUserId ? 'POS BLOQUEADO' : 'ENTRAR NO POS'}
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">
            {selected ? selected.full_name : 'Toca no teu cartão'}
          </h1>
          <p className="mt-2 text-sm text-[#847e72]">
            {[storeName, deviceLabel].filter(Boolean).join(' · ') || 'Terminal de balcão'}
          </p>
        </header>

        {!selected && (
          <>
            {cards.length === 0 ? (
              <p className="mx-auto mt-10 max-w-lg rounded-2xl border border-amber-500/40 bg-amber-500/[0.08] p-5 text-center text-amber-200">
                Esta loja ainda não tem ninguém com acesso. O dono cria as contas
                em <strong>Equipa</strong>, no painel.
              </p>
            ) : (
              <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {cards.map((card) => {
                  const state = cardState(card);
                  const espera = lockCountdown(card.locked_until);
                  return (
                    <button
                      key={card.user_id}
                      type="button"
                      onClick={() => escolher(card)}
                      className={`min-h-44 rounded-3xl border-2 p-4 text-left transition active:scale-[0.98] ${
                        state === 'ready'
                          ? 'border-white/12 bg-[#151310] hover:border-[#e5a93c]/60'
                          : 'border-white/[0.06] bg-[#111110] opacity-60'
                      }`}
                    >
                      <span
                        className={`grid h-16 w-16 place-items-center rounded-2xl text-2xl font-black ${
                          state === 'ready'
                            ? 'bg-[#e5a93c] text-black'
                            : 'bg-white/10 text-[#847e72]'
                        }`}
                      >
                        {cardInitials(card.full_name)}
                      </span>
                      <span className="mt-4 block text-xl font-black leading-tight">
                        {card.full_name}
                      </span>
                      <span className="mt-1 block text-sm font-bold text-[#847e72]">
                        {roleLabel(card.role)}
                        {card.user_id === currentUserId && ' · em turno'}
                      </span>
                      {state === 'no-pin' && (
                        <span className="mt-2 block text-xs font-bold text-amber-300">
                          PIN por definir
                        </span>
                      )}
                      {state === 'locked' && (
                        <span className="mt-2 block text-xs font-bold text-red-300">
                          Bloqueado {espera ? `· ${espera}` : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {selected && (
          <section className="mx-auto mt-8 w-full max-w-sm">
            <div className="flex min-h-16 items-center justify-center gap-3">
              {Array.from({ length: POS_PIN_MAX }).map((_, indice) => (
                <span
                  key={indice}
                  className={`h-4 w-4 rounded-full ${
                    indice < pin.length
                      ? 'bg-[#e5a93c]'
                      : indice < POS_PIN_MIN
                        ? 'bg-white/25'
                        : 'bg-white/10'
                  }`}
                />
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digito) => (
                <button
                  key={digito}
                  type="button"
                  onClick={() => setPin((actual) => appendPinDigit(actual, digito))}
                  className="min-h-20 rounded-2xl bg-white/[0.08] text-3xl font-black active:bg-white/20"
                >
                  {digito}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPin((actual) => actual.slice(0, -1))}
                aria-label="Apagar"
                className="min-h-20 rounded-2xl bg-white/[0.04] text-2xl font-black text-[#847e72] active:bg-white/15"
              >
                ⌫
              </button>
              <button
                type="button"
                onClick={() => setPin((actual) => appendPinDigit(actual, '0'))}
                className="min-h-20 rounded-2xl bg-white/[0.08] text-3xl font-black active:bg-white/20"
              >
                0
              </button>
              <button
                type="button"
                disabled={submitting || pin.length < POS_PIN_MIN}
                onClick={() => void submit()}
                className="min-h-20 rounded-2xl bg-emerald-500 text-lg font-black text-black disabled:opacity-30"
              >
                {submitting ? '…' : 'Entrar'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setPin('');
                setError(null);
              }}
              className="mt-4 min-h-16 w-full rounded-2xl bg-white/[0.06] font-black active:bg-white/15"
            >
              Voltar aos cartões
            </button>
          </section>
        )}

        {error && (
          <p
            role="alert"
            className="mx-auto mt-6 max-w-lg rounded-2xl bg-red-950/60 p-4 text-center font-bold text-red-200"
          >
            {error}
          </p>
        )}

        {footer && <div className="mx-auto mt-10 max-w-lg border-t border-white/10 pt-6">{footer}</div>}
      </div>
    </div>
  );
}
