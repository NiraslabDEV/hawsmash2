import { describe, expect, it } from 'vitest';

import { connectionStatus } from '../connection-status';

describe('estado de ligação do POS', () => {
  it('mostra offline e a fila por sincronizar', () => {
    expect(connectionStatus(false, 3, 0)).toEqual({
      label: 'SEM LIGAÇÃO · 3 vendas por sincronizar',
      tone: 'offline',
    });
  });

  it('prioriza a confirmação verde após sincronizar', () => {
    expect(connectionStatus(true, 0, 3)).toEqual({
      label: '3 vendas sincronizadas',
      tone: 'synced',
    });
    expect(connectionStatus(true, 0, 0)).toEqual({ label: 'ONLINE', tone: 'online' });
  });
});
