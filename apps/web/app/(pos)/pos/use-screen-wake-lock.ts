'use client';

import { useEffect } from 'react';

type Sentinel = { released: boolean; release: () => Promise<void>; addEventListener: (type: 'release', cb: () => void) => void };
type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> };

/**
 * Mantém o ecrã do balcão ligado enquanto `active` — o POS não apaga a meio
 * do turno nem deixa o PC adormecer por falta de toques.
 *
 * O browser larga o pedido sempre que a janela fica escondida (minimizada,
 * outra aplicação à frente); volta a pedi-lo quando o POS regressa. Sem
 * suporte ou sem permissão, não faz nada: fica o que o Windows decidir
 * (hardware.md pede suspensão desligada e ecrã sempre ligado).
 */
export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
    if (!active || !api) return;

    let sentinel: Sentinel | null = null;
    let pedindo = false;
    let acabou = false;

    const pedir = async () => {
      if (acabou || pedindo || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      pedindo = true;
      try {
        const novo = await api.request('screen');
        if (acabou) {
          void novo.release().catch(() => undefined);
          return;
        }
        sentinel = novo;
      } catch {
        // Sem permissão (ex.: poupança de energia): o POS continua igual.
      } finally {
        pedindo = false;
      }
    };
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void pedir();
    };

    void pedir();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      acabou = true;
      document.removeEventListener('visibilitychange', aoVoltar);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
}
