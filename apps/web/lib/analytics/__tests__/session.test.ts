/**
 * Sessão first-party do funil.
 *
 * BUG QUE ISTO TRANCA: nada gerava o cookie `dl_session`, por isso o
 * /api/track gravava TODOS os eventos com session_id = 'unknown'. A view
 * funnel_rates agrupa por session_id → o painel Análise mostrava sempre
 * "1 sessão" (6.059 eventos reais colapsados numa linha só).
 */
import { describe, it, expect } from 'vitest';
import { SESSION_COOKIE, SESSION_MAX_AGE, newSessionId, resolveSessionId } from '../session';

describe('newSessionId', () => {
  it('gera ids distintos', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSessionId()));
    expect(ids.size).toBe(200);
  });

  it('nunca gera o sentinela "unknown"', () => {
    for (let i = 0; i < 50; i++) expect(newSessionId()).not.toBe('unknown');
  });
});

describe('resolveSessionId', () => {
  it('cria sessão nova quando não há cookie', () => {
    const r = resolveSessionId(undefined);
    expect(r.isNew).toBe(true);
    expect(r.id.length).toBeGreaterThan(10);
  });

  it('reutiliza o cookie existente (o funil precisa do mesmo id do view_menu até ao purchase)', () => {
    const r = resolveSessionId('abc123def456');
    expect(r.isNew).toBe(false);
    expect(r.id).toBe('abc123def456');
  });

  it('descarta cookie vazio, "unknown" ou com lixo', () => {
    for (const bad of ['', '   ', 'unknown', 'a b c', 'x'.repeat(200), 'drop;table']) {
      expect(resolveSessionId(bad).isNew).toBe(true);
    }
  });

  it('duas visitas sem cookie são duas sessões — não colapsam numa', () => {
    expect(resolveSessionId(undefined).id).not.toBe(resolveSessionId(undefined).id);
  });
});

describe('constantes', () => {
  it('o nome do cookie bate com o que o /api/track lê', () => {
    expect(SESSION_COOKIE).toBe('dl_session');
  });

  it('a janela de sessão é de 30 minutos (convenção GA4)', () => {
    expect(SESSION_MAX_AGE).toBe(30 * 60);
  });
});
