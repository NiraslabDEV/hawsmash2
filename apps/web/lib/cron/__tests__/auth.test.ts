import { describe, expect, it } from 'vitest';

import { cronUnauthorized } from '../auth';

const req = (authorization?: string) =>
  new Request('https://loja.example/api/cron/alerts', authorization ? { headers: { authorization } } : {});

describe('cronUnauthorized — porta dos crons fechada por omissão', () => {
  it('sem CRON_SECRET configurado recusa com 503 (nunca corre aberto)', () => {
    expect(cronUnauthorized(req(), '')?.status).toBe(503);
    expect(cronUnauthorized(req('Bearer qualquer'), undefined)?.status).toBe(503);
  });
  it('sem cabeçalho ou com segredo errado recusa com 401', () => {
    expect(cronUnauthorized(req(), 'PLACEHOLDER_SEGREDO')?.status).toBe(401);
    expect(cronUnauthorized(req('Bearer PLACEHOLDER_ERRADO'), 'PLACEHOLDER_SEGREDO')?.status).toBe(401);
    expect(cronUnauthorized(req('PLACEHOLDER_SEGREDO'), 'PLACEHOLDER_SEGREDO')?.status).toBe(401);
  });
  it('com o segredo certo deixa seguir', () => {
    expect(cronUnauthorized(req('Bearer PLACEHOLDER_SEGREDO'), 'PLACEHOLDER_SEGREDO')).toBeNull();
  });
});
