import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSystemTemplate } from '../system-catalog';
vi.mock('@/lib/brand/server', () => ({
  getBrand: async () => ({ name: 'Marca de exemplo' }),
}));
const state = vi.hoisted(() => ({
  config: null as unknown,
  fail: false,
  filters: [] as unknown[],
  log: [] as unknown[],
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (key: string, value: string) => {
          state.filters.push([table, key, value]);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (state.fail) throw new Error('offline');
          return {
            data:
              table === 'stores'
                ? { id: 'store-a', name: 'Loja A', slug: 'loja-a' }
                : state.config,
          };
        },
        insert: async (data: unknown) => {
          state.log.push(data);
          return { error: null };
        },
      };
      return chain;
    },
  }),
}));
import { prepareSystemEmail, logSystemEmail } from '../system-runtime';
const original = {
  event: 'paid' as const,
  storeId: 'store-a',
  subject: 'Pedido 15',
  html: '<p>450 MT</p>',
  variables: { nome: 'Cliente' },
};
beforeEach(() => {
  state.config = null;
  state.fail = false;
  state.filters = [];
  state.log = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
});
describe('ligação aos emails existentes', () => {
  it('mantém assunto e HTML exactos no modelo actual e filtra pela loja', async () => {
    state.config = defaultSystemTemplate('paid');
    const result = await prepareSystemEmail(original);
    expect(result.html).toBe(original.html);
    expect(result.subject).toBe(original.subject);
    expect(state.filters).toContainEqual([
      'email_system_templates',
      'store_id',
      'store-a',
    ]);
  });
  it('usa personalização guardada no envio, preservando dados operacionais', async () => {
    state.config = {
      ...defaultSystemTemplate('paid'),
      mode: 'custom',
      step: {
        ...defaultSystemTemplate('paid').step,
        blocks: [{ type: 'heading', text: 'Olá {{nome}}' }, { type: 'system' }],
      },
    };
    const result = await prepareSystemEmail(original);
    expect(result.html).toContain('Olá Cliente');
    expect(result.html).toContain('450 MT');
  });
  it('respeita o email desligado e não lança quando a BD está indisponível', async () => {
    state.config = { ...defaultSystemTemplate('paid'), enabled: false };
    expect((await prepareSystemEmail(original)).enabled).toBe(false);
    state.fail = true;
    expect(await prepareSystemEmail(original)).toMatchObject({
      enabled: true,
      html: original.html,
    });
  });
  it('regista estado e destinatário sem guardar HTML, assunto ou código', async () => {
    await logSystemEmail(
      'account_code',
      'store-a',
      ['cliente@example.com'],
      'sent',
    );
    expect(state.log).toEqual([
      [
        {
          store_id: 'store-a',
          event: 'account_code',
          recipient: 'cliente@example.com',
          status: 'sent',
        },
      ],
    ]);
  });
  it('usa a marca nos emails globais, sem os assinar com uma loja específica', async () => {
    state.config = {
      ...defaultSystemTemplate('digest'),
      mode: 'custom',
      step: {
        ...defaultSystemTemplate('digest').step,
        blocks: [{ type: 'heading', text: '{{loja}}' }, { type: 'system' }],
      },
    };
    const result = await prepareSystemEmail({
      ...original,
      event: 'digest',
      storeId: undefined,
    });
    expect(result.html).toContain('Marca de exemplo');
    expect(result.html).not.toContain('Loja A');
  });
});
