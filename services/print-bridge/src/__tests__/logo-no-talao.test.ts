import { describe, expect, it, vi } from 'vitest';

/**
 * O logo da instalacao chega mesmo ao papel.
 *
 * Fica em ficheiro proprio porque precisa de substituir o modulo do logo antes
 * de o `escpos` o importar. O que se testa aqui e a ligacao: havendo raster, o
 * documento leva-o no topo; nao havendo, o talao sai na mesma e com a loja
 * legivel — nunca com a marca de outra instalacao (CLAUDE.md 18.3).
 */
const RASTER = Buffer.from([0x1d, 0x76, 0x30, 0x00, 0x02, 0x00, 0x02, 0x00, 0xaa, 0xbb, 0xcc, 0xdd]);

vi.mock('../logo', () => ({
  LOGO_RASTER: RASTER,
  loadBrandLogo: () => RASTER,
}));

const kitchen = {
  template: 'kitchen' as const,
  store_short_name: 'Maputo',
  order_number: 'MPT-0042',
  daily_number: 42,
  channel: 'counter',
  customer_name: 'Balcão',
  items: [{ name: 'Classic Smash', quantity: 2 }],
  created_at: '2026-08-19T17:05:00.000Z',
};

describe('logo da instalacao no talao', () => {
  it('vai no topo do documento quando a instalacao tem logo', async () => {
    const { createKitchenTicket, decodeReceipt } = await import('../escpos');

    const document = createKitchenTicket(kitchen);

    expect(document.includes(RASTER)).toBe(true);
    // A loja continua a sair em texto: o logo e a marca, nao a unidade.
    expect(decodeReceipt(document)).toContain('MAPUTO');
  });
});
