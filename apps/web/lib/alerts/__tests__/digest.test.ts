import { describe, expect, it } from 'vitest';

import {
  alertEmailHtml,
  alertSubject,
  pendingAlerts,
  whatsappLink,
  type SystemAlert,
} from '../digest';

const alerts: SystemAlert[] = [
  {
    store_id: 'store-maputo',
    store_name: 'Maputo',
    kind: 'device_silent',
    severity: 'critical',
    message: 'Bridge sem sinal desde 19/08 20:10',
  },
  {
    store_id: 'store-matola',
    store_name: 'Matola',
    kind: 'stock',
    severity: 'warning',
    message: 'Classic Smash com 1 unidade(s)',
  },
];

describe('alertas automáticos', () => {
  it('não repete o mesmo alerta dentro do arrefecimento', () => {
    const now = new Date('2026-08-19T20:00:00Z');
    const sent = [
      { store_id: 'store-maputo', kind: 'device_silent', sent_at: '2026-08-19T19:50:00Z' },
      { store_id: 'store-matola', kind: 'stock', sent_at: '2026-08-19T18:00:00Z' },
    ];

    const pending = pendingAlerts(alerts, sent, now);
    expect(pending.map((alert) => alert.kind)).toEqual(['stock']);
  });

  it('volta a avisar quando o problema persiste depois do arrefecimento', () => {
    const now = new Date('2026-08-19T21:00:00Z');
    const sent = [
      { store_id: 'store-maputo', kind: 'device_silent', sent_at: '2026-08-19T19:50:00Z' },
    ];
    expect(pendingAlerts(alerts, sent, now)).toHaveLength(2);
  });

  it('constrói o link de WhatsApp com indicativo de Moçambique', () => {
    expect(whatsappLink('86 076 0009', 'Bridge em baixo')).toBe(
      'https://wa.me/258860760009?text=Bridge%20em%20baixo',
    );
    expect(whatsappLink('+258 84 000 0000', 'olá')).toBe('https://wa.me/258840000000?text=ol%C3%A1');
    expect(whatsappLink(null, 'olá')).toBeNull();
    expect(whatsappLink('123', 'olá')).toBeNull();
  });

  it('resume no assunto quantos alertas críticos há e em que lojas', () => {
    expect(alertSubject(alerts)).toBe('HAWSMASH · 1 alerta(s) crítico(s) em Maputo e Matola');
    expect(alertSubject([alerts[1]])).toBe('HAWSMASH · 1 aviso(s) em Matola');
  });

  it('agrupa o email por loja, com botão de WhatsApp e sem HTML injectado', () => {
    const html = alertEmailHtml(
      [
        ...alerts,
        {
          store_id: 'store-maputo',
          store_name: 'Maputo',
          kind: 'print_failed',
          severity: 'critical',
          message: '<script>alert(1)</script>',
        },
      ],
      [
        { store_id: 'store-maputo', store_name: 'Maputo', phone: '860760009' },
        { store_id: 'store-matola', store_name: 'Matola', phone: null },
      ],
    );

    expect(html).toContain('Maputo');
    expect(html).toContain('Matola');
    expect(html).toContain('https://wa.me/258860760009');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
