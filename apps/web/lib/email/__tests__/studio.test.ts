import { describe, expect, it } from 'vitest';
import {
  flowSchema,
  renderMessage,
  nextDelivery,
  defaultStep,
} from '../studio';

describe('editor de emails', () => {
  it('escapa conteúdo, incluindo variáveis, sem executar HTML', () => {
    const step = defaultStep();
    step.blocks = [
      { type: 'text', text: 'Olá {{nome}} <script>roubar()</script>' },
    ];
    const result = renderMessage(step, { nome: '<img src=x onerror=x>' });
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('<img src=x');
    expect(result.html).toContain('&lt;img');
  });
  it('recusa URLs executáveis e intervalos negativos', () => {
    const flow = {
      name: 'Promoção',
      kind: 'marketing',
      trigger: 'manual',
      status: 'draft',
      steps: [defaultStep()],
    };
    expect(flowSchema.safeParse(flow).success).toBe(true);
    expect(
      flowSchema.safeParse({
        ...flow,
        steps: [{ ...defaultStep(), delay_minutes: -1 }],
      }).success,
    ).toBe(false);
    expect(
      flowSchema.safeParse({
        ...flow,
        steps: [
          {
            ...defaultStep(),
            blocks: [
              { type: 'button', text: 'Abrir', url: 'javascript:alert(1)' },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('não permite gatilhos transaccionais numa promoção', () => {
    expect(
      flowSchema.safeParse({
        name: 'X',
        kind: 'marketing',
        trigger: 'paid',
        status: 'active',
        steps: [defaultStep()],
      }).success,
    ).toBe(false);
  });
  it('calcula a espera a partir do envio real anterior em UTC', () => {
    expect(nextDelivery('2026-09-30T23:50:00Z', 30)).toBe(
      '2026-10-01T00:20:00.000Z',
    );
    expect(() => nextDelivery('2026-09-30T23:50:00Z', -1)).toThrow();
  });
  it('inclui cancelamento de subscrição e não transforma variáveis em HTML', () => {
    const result = renderMessage(
      defaultStep(),
      {},
      'https://example.test/email/subscricao?t=token',
    );
    expect(result.html).toContain('Cancelar subscrição');
    expect(result.html).toContain(
      'https://example.test/email/subscricao?t=token',
    );
  });
});
