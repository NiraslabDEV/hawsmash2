import { describe, expect, it } from 'vitest';

import {
  deltaPct,
  fillDays,
  fillHours,
  formatMinutes,
  highlights,
  itemsPerOrder,
  originShare,
  periodRange,
  rankWaiters,
  type WaiterMetrics,
} from '../metricas';

function garcom(id: string, extra: Partial<WaiterMetrics> = {}): WaiterMetrics {
  return {
    id,
    full_name: id,
    active: true,
    store_short_name: 'Maputo',
    orders: 0,
    revenue_cents: 0,
    avg_ticket_cents: 0,
    items: 0,
    tables: 0,
    active_days: 0,
    extras_cents: 0,
    served: 0,
    median_minutes_to_serve: null,
    cancelled_orders: 0,
    removed_events: 0,
    removed_cents: 0,
    paid_cents: 0,
    open_cents: 0,
    last_order_at: null,
    ...extra,
  };
}

describe('o período', () => {
  // 23:30 UTC de 5 Nov já é dia 6 em Maputo.
  const tarde = new Date('2026-11-05T23:30:00Z');

  it('hoje é o dia de Maputo, não o de UTC', () => {
    expect(periodRange('today', tarde)).toMatchObject({
      from: '2026-11-05T22:00:00.000Z',
      to: '2026-11-06T22:00:00.000Z',
    });
  });

  it('7 dias conta hoje e os seis anteriores, e compara com os sete de antes', () => {
    const r = periodRange('7d', new Date('2026-11-05T10:00:00Z'));
    expect(r.from).toBe('2026-10-29T22:00:00.000Z');
    expect(r.to).toBe('2026-11-05T22:00:00.000Z');
    expect(r.previous).toEqual({ from: '2026-10-22T22:00:00.000Z', to: '2026-10-29T22:00:00.000Z' });
  });

  it('este mês começa no dia 1 em Maputo', () => {
    expect(periodRange('month', new Date('2026-11-05T10:00:00Z')).from).toBe('2026-10-31T22:00:00.000Z');
  });

  it('tudo não tem janela nem comparação', () => {
    expect(periodRange('all')).toEqual({ from: null, to: null, previous: null });
  });

  it('sem base não se inventa percentagem', () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(10, 0)).toBeNull();
    expect(deltaPct(10, null)).toBeNull();
  });
});

describe('o ranking', () => {
  const ana = garcom('Ana', { orders: 10, revenue_cents: 500, avg_ticket_cents: 50 });
  const beto = garcom('Beto', { orders: 20, revenue_cents: 400, avg_ticket_cents: 20 });
  const carla = garcom('Carla', { orders: 10, revenue_cents: 900, avg_ticket_cents: 90 });

  it('ordena pela métrica escolhida e desempata por vendas', () => {
    expect(rankWaiters([ana, beto, carla], 'orders').map((w) => w.id)).toEqual(['Beto', 'Carla', 'Ana']);
    expect(rankWaiters([ana, beto, carla], 'revenue_cents').map((w) => w.id)).toEqual(['Carla', 'Ana', 'Beto']);
  });

  it('não mexe na lista original', () => {
    const lista = [ana, beto];
    rankWaiters(lista, 'orders');
    expect(lista[0]).toBe(ana);
  });

  it('artigos por pedido sem dividir por zero', () => {
    expect(itemsPerOrder({ items: 7, orders: 2 })).toBe(3.5);
    expect(itemsPerOrder({ items: 0, orders: 0 })).toBe(0);
  });
});

describe('os destaques', () => {
  it('sem pedidos ninguém ganha nada', () => {
    expect(highlights([garcom('Ana'), garcom('Beto')])).toEqual([]);
  });

  it('um pedido caro só não faz o maior ticket', () => {
    const sorte = garcom('Sorte', { orders: 1, revenue_cents: 9000, avg_ticket_cents: 9000 });
    const certa = garcom('Certa', { orders: 5, revenue_cents: 5000, avg_ticket_cents: 1000 });
    const ticket = highlights([sorte, certa]).find((h) => h.label === 'Maior ticket médio');
    expect(ticket?.waiter.id).toBe('Certa');
  });

  it('o mais rápido é o de menos minutos, com amostra, e ignora quem não tem dados', () => {
    const rapido = garcom('Rápido', { orders: 6, revenue_cents: 1, median_minutes_to_serve: 8 });
    const lento = garcom('Lento', { orders: 6, revenue_cents: 1, median_minutes_to_serve: 20 });
    const semDados = garcom('Sem', { orders: 6, revenue_cents: 1 });
    const poucos = garcom('Poucos', { orders: 1, revenue_cents: 1, median_minutes_to_serve: 2 });
    const h = highlights([lento, semDados, poucos, rapido]).find((x) => x.label === 'Mais rápido a servir');
    expect(h).toMatchObject({ value: 8, kind: 'minutes' });
    expect(h?.waiter.id).toBe('Rápido');
  });

  it('em empate ganha quem vendeu mais', () => {
    const a = garcom('A', { orders: 5, revenue_cents: 100 });
    const b = garcom('B', { orders: 5, revenue_cents: 300 });
    expect(highlights([a, b]).find((h) => h.label === 'Mais pedidos')?.waiter.id).toBe('B');
  });
});

describe('os gráficos', () => {
  it('os dias sem pedidos aparecem a zero, em dias de Maputo', () => {
    const dias = fillDays([{ day: '2026-11-04', orders: 3, revenue_cents: 100 }], periodRange('7d', new Date('2026-11-05T10:00:00Z')));
    expect(dias).toHaveLength(7);
    expect(dias[0].day).toBe('2026-10-30');
    expect(dias[6]).toEqual({ day: '2026-11-05', orders: 0, revenue_cents: 0 });
    expect(dias[5]).toEqual({ day: '2026-11-04', orders: 3, revenue_cents: 100 });
  });

  it('em "tudo" vai do primeiro ao último dia com pedidos, e vazio fica vazio', () => {
    const rows = [
      { day: '2026-11-01', orders: 1, revenue_cents: 1 },
      { day: '2026-11-03', orders: 1, revenue_cents: 1 },
    ];
    expect(fillDays(rows, { from: null, to: null }).map((d) => d.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(fillDays([], { from: null, to: null })).toEqual([]);
  });

  it('as horas vão da primeira à última com pedidos, sem buracos', () => {
    expect(fillHours([{ hour: 12, orders: 2 }, { hour: 14, orders: 1 }])).toEqual([
      { hour: '12h', orders: 2 },
      { hour: '13h', orders: 0 },
      { hour: '14h', orders: 1 },
    ]);
    expect(fillHours([])).toEqual([]);
  });

  it('as fatias da sala somam 100, e zero pedidos não dividem por zero', () => {
    const s = originShare({
      waiter: { orders: 1, revenue_cents: 0 },
      counter: { orders: 1, revenue_cents: 0 },
      qr: { orders: 1, revenue_cents: 0 },
    });
    expect(s.waiter + s.counter + s.qr).toBe(100);
    const vazio = { orders: 0, revenue_cents: 0 };
    expect(originShare({ waiter: vazio, counter: vazio, qr: vazio })).toEqual({ waiter: 0, counter: 0, qr: 0 });
  });

  it('os minutos: uma casa só abaixo de dez, traço sem dados', () => {
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(8.5)).toBe('8,5 min');
    expect(formatMinutes(23.4)).toBe('23 min');
  });
});
