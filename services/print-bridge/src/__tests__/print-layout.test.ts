import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createKitchenTicket, decodeReceipt } from '../escpos';
import {
  currentPrintLayout,
  loadCachedPrintLayout,
  resetPrintLayout,
  setPrintLayout,
  syncPrintLayout,
} from '../print-layout';
import type { KitchenTicketPayload } from '../types';

/**
 * O talão sai como a loja escolheu na aba POS — e continua assim sem rede.
 */

const online: KitchenTicketPayload = {
  template: 'kitchen',
  formato: 'talao_completo',
  via: 'controlo',
  store_short_name: 'Maputo',
  order_number: 'MPT-0042',
  daily_number: 7,
  channel: 'pickup',
  fulfillment_type: 'pickup',
  customer_name: 'Ana',
  items: [{ name: 'Classic Smash', quantity: 1, line_total_cents: 30000 }],
  subtotal_cents: 30000,
  total_cents: 30000,
  payment_method: 'mpesa',
  created_at: '2026-09-23T13:04:00.000Z',
};

function clienteFalso(resposta: { data: unknown; error: { message: string } | null }): SupabaseClient {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: () => Promise.resolve(resposta),
  };
  return { from: () => consulta } as unknown as SupabaseClient;
}

const ficheiro = () => path.join(mkdtempSync(path.join(tmpdir(), 'layout-')), 'data', 'print-layout.json');

afterEach(() => resetPrintLayout());

describe('layout do talão no bridge', () => {
  it('o talão usa o modelo que está em vigor', () => {
    expect(decodeReceipt(createKitchenTicket(online))).toContain('TOTAL:');
    setPrintLayout({ templates: { controlo: 'cozinha' } });
    const cozinha = decodeReceipt(createKitchenTicket(online));
    expect(cozinha).not.toContain('TOTAL');
    expect(cozinha).toContain('SENHA');
  });

  it('lê o layout da loja, aplica-o e guarda a cópia para quando não houver rede', async () => {
    const destino = ficheiro();
    const leu = await syncPrintLayout(
      clienteFalso({ data: { config: { printing: { templates: { controlo: 'compacto' } } } }, error: null }),
      'loja',
      destino,
    );
    expect(leu).toBe(true);
    expect(currentPrintLayout().templates.controlo).toBe('compacto');
    expect(JSON.parse(readFileSync(destino, 'utf8')).templates.controlo).toBe('compacto');

    // Reinício sem rede: volta a cópia, não o de fábrica.
    resetPrintLayout();
    expect(loadCachedPrintLayout(destino).templates.controlo).toBe('compacto');
  });

  it('um erro a ler mantém o que estava — nunca fica sem talão', async () => {
    setPrintLayout({ templates: { controlo: 'cozinha' } });
    const leu = await syncPrintLayout(clienteFalso({ data: null, error: { message: 'sem rede' } }), 'loja', ficheiro());
    expect(leu).toBe(false);
    expect(currentPrintLayout().templates.controlo).toBe('cozinha');
  });

  it('uma loja sem nada gravado imprime o de fábrica', async () => {
    setPrintLayout({ templates: { controlo: 'cozinha' } });
    await syncPrintLayout(clienteFalso({ data: null, error: null }), 'loja', ficheiro());
    expect(currentPrintLayout().templates.controlo).toBe('completo');
  });

  it('sem cópia em disco, arranca com o de fábrica', () => {
    expect(loadCachedPrintLayout(path.join(tmpdir(), 'nao-existe', 'x.json')).templates.controlo).toBe('completo');
  });
});
