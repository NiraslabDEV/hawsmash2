import { parseMenuCategories, type PosMenuCategory } from '@/lib/pos/offline-store';

import type { WaiterAction, WaiterState } from './contract';

/**
 * As chamadas do telemóvel do garçom a `/api/garcom` (1122). O token vai no
 * cookie httpOnly: o JavaScript da página nunca o vê.
 */

/** A rota respondeu 401: o ecrã volta ao login. */
export class SemSessao extends Error {}

export async function lerEstado(): Promise<WaiterState> {
  const res = await fetch('/api/garcom', { cache: 'no-store' });
  if (res.status === 401) throw new SemSessao();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Sem ligação.');
  return body as WaiterState;
}

export async function lerCardapio(): Promise<PosMenuCategory[]> {
  const res = await fetch('/api/garcom/cardapio', { cache: 'no-store' });
  if (res.status === 401) throw new SemSessao();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Sem ligação.');
  return parseMenuCategories(body.categories);
}

export type Resposta<T = unknown> = {
  ok: boolean;
  /** 0 = sem resposta (rede caiu a meio). */
  status: number;
  error?: string;
  reason?: string | null;
  data?: T;
};

export async function enviarAcao<T = unknown>(action: WaiterAction): Promise<Resposta<T>> {
  try {
    const res = await fetch('/api/garcom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, status: res.status, data: body as T }
      : { ok: false, status: res.status, error: body.error, reason: body.reason ?? null };
  } catch {
    return { ok: false, status: 0, error: 'Sem rede. Toca outra vez — não fica nada em dobro.' };
  }
}
