import { describe, expect, it, vi } from 'vitest';

import { HEARTBEAT_MS, sendPosHeartbeat } from '../heartbeat';

describe('sinal de vida do POS (1114)', () => {
  it('bate de minuto a minuto — quinze tentativas antes do limiar de 15 min da base', () => {
    expect(HEARTBEAT_MS).toBe(60_000);
  });

  it('manda o id do terminal ao servidor', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const ok = await sendPosHeartbeat({ rpc } as never, 'device-1', true);

    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'pos_heartbeat',
      expect.objectContaining({ p_device_id: 'device-1' }),
    );
  });

  it('sem rede não tenta — o POS está a vender offline, e isso é por desenho', async () => {
    const rpc = vi.fn();
    expect(await sendPosHeartbeat({ rpc } as never, 'device-1', false)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('nunca lança: um sinal de vida falhado não pode chegar ao balcão', async () => {
    const comErro = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    expect(await sendPosHeartbeat({ rpc: comErro } as never, 'device-1', true)).toBe(false);

    const aRebentar = vi.fn().mockRejectedValue(new Error('rede caiu a meio'));
    expect(await sendPosHeartbeat({ rpc: aRebentar } as never, 'device-1', true)).toBe(false);
  });
});
