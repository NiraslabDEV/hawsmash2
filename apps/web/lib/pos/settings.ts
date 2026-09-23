/**
 * Definições do POS, por loja.
 *
 * Até aqui o balcão tinha a sua configuração escrita no código: os meios de
 * pagamento, as notas rápidas ("SEM CEBOLA"), as frases do upsell, o tipo de
 * pedido com que abre. Mudar uma frase era um deploy, e levar o POS para outro
 * restaurante era reescrever um ficheiro com o cardápio de outro (§18.2/§18.3).
 *
 * Agora vivem em `store_pos_settings.config` (migration 1067), uma linha por
 * loja, editadas na aba **POS** do painel. Este módulo é o contrato:
 *
 * - `FACTORY_POS_SETTINGS` — o que o POS usa quando a loja não gravou nada.
 *   Neutro de propósito: não fala de nenhum produto nem de nenhuma marca.
 * - `resolvePosSettings(raw)` — lê o jsonb da BD **campo a campo**: o que vier
 *   estragado ou em falta cai no valor de fábrica, o resto fica. Uma definição
 *   mal gravada nunca pode deixar o balcão sem vender (Regra 1).
 * - cache em `localStorage` — offline o POS continua a ter os seus meios de
 *   pagamento e as suas notas (CLAUDE §7.5).
 *
 * O que isto NÃO decide: preços, taxas, troco, estado de pagamento — isso é
 * sempre do servidor (Regra 2). Esconder o cartão no POS é uma escolha de
 * ecrã; não é uma regra de dinheiro, e o servidor não a impõe (uma venda
 * offline feita antes da mudança tem de continuar a sincronizar).
 *
 * Portável: não importa nada do resto do POS. Ver `docs/POS-DEFINICOES.md`.
 */

export type PosPaymentMethodId = 'cash' | 'mpesa' | 'emola' | 'credit_card';
export type PosFulfillment = 'counter' | 'pickup' | 'delivery';
export type PosUpsellStepId = 'companion' | 'dessert';

export type PosPaymentMethodSetting = {
  id: PosPaymentMethodId;
  enabled: boolean;
  /** O que aparece no botão. "Cartão", "POS bancário", "Visa"… */
  label: string;
};

export type PosUpsellStepSetting = {
  enabled: boolean;
  /** Cabeçalho do ecrã. Curto: lê-se de relance. */
  title: string;
  /** Frases que o operador diz ao cliente. Roda uma por venda. */
  scripts: string[];
};

export type PosSettings = {
  payments: {
    /** Por ordem de apresentação no ecrã de pagamento. Sempre os quatro. */
    methods: PosPaymentMethodSetting[];
    /** Deixa dividir a conta (dinheiro + móvel). */
    allowMixed: boolean;
  };
  upsell: {
    enabled: boolean;
    steps: Record<PosUpsellStepId, PosUpsellStepSetting>;
  };
  /** Atalhos de nota, no artigo e no pedido. Somam-se (`lib/pos/notes.ts`). */
  quickNotes: string[];
  cart: {
    /** Com que tipo de pedido o POS abre e volta depois de cada venda. */
    defaultFulfillment: PosFulfillment;
    /** Mostra nome e telefone também na venda de balcão (para o CRM). */
    askCustomerOnCounter: boolean;
  };
  sale: {
    /** Quanto tempo fica o ecrã "venda registada" antes de voltar ao início. */
    confirmationSeconds: number;
  };
  alerts: {
    /** Toca quando chega um pedido online. */
    newOrderChime: boolean;
  };
};

export const POS_PAYMENT_METHOD_IDS: readonly PosPaymentMethodId[] = [
  'cash',
  'mpesa',
  'emola',
  'credit_card',
];

export const POS_PAYMENT_METHOD_NAMES: Record<PosPaymentMethodId, string> = {
  cash: 'Dinheiro',
  mpesa: 'M-Pesa',
  emola: 'e-Mola',
  credit_card: 'Cartão',
};

export const POS_FULFILLMENT_NAMES: Record<PosFulfillment, string> = {
  counter: 'Balcão',
  pickup: 'Levantamento',
  delivery: 'Entrega',
};

export const POS_UPSELL_STEP_NAMES: Record<PosUpsellStepId, string> = {
  companion: 'Acompanhar (batata, bebida)',
  dessert: 'Sobremesa (no fim)',
};

/** Limites — o painel respeita-os e o resolver corta o que passar. */
export const POS_LIMITS = {
  labelMax: 24,
  titleMax: 60,
  scriptMax: 160,
  scriptsPerStep: 12,
  quickNoteMax: 40,
  quickNotes: 24,
  confirmationMin: 1,
  confirmationMax: 15,
} as const;

export const FACTORY_POS_SETTINGS: PosSettings = {
  payments: {
    methods: POS_PAYMENT_METHOD_IDS.map((id) => ({
      id,
      enabled: true,
      label: POS_PAYMENT_METHOD_NAMES[id],
    })),
    allowMixed: true,
  },
  upsell: {
    enabled: true,
    steps: {
      companion: {
        enabled: true,
        title: 'Falta acompanhar?',
        scripts: [
          'Quer completar com um acompanhamento e uma bebida?',
          'Qual bebida vai levar?',
          'Junto um acompanhamento? Fica completo.',
          'Uma bebida gelada para acompanhar?',
        ],
      },
      dessert: {
        enabled: true,
        title: 'E para fechar?',
        scripts: ['Uma sobremesa para fechar?', 'Leva uma sobremesa para depois?'],
      },
    },
  },
  quickNotes: [
    'SEM CEBOLA',
    'SEM MOLHO',
    'SEM QUEIJO',
    'SEM TOMATE',
    'SEM PICANTE',
    'BEM PASSADO',
    'MAL PASSADO',
    'PARA LEVAR',
  ],
  cart: {
    defaultFulfillment: 'counter',
    askCustomerOnCounter: true,
  },
  sale: {
    confirmationSeconds: 3,
  },
  alerts: {
    newOrderChime: true,
  },
};

// ─── leitura tolerante ───────────────────────────────────────────────────────

type Loose = Record<string, unknown>;

function obj(value: unknown): Loose | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  const limpo = value.trim().slice(0, max);
  return limpo || fallback;
}

/** Lista de textos: limpa, sem vazios, sem repetidos, com tecto. */
function textList(value: unknown, fallback: string[], maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const limpo = entry.trim().slice(0, maxLen);
    const chave = limpo.toLocaleUpperCase('pt-PT');
    if (!limpo || vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push(limpo);
    if (lista.length >= maxItems) break;
  }
  return lista;
}

function resolveMethods(value: unknown): PosPaymentMethodSetting[] {
  const fabrica = FACTORY_POS_SETTINGS.payments.methods;
  if (!Array.isArray(value)) return fabrica.map((m) => ({ ...m }));

  const lidos: PosPaymentMethodSetting[] = [];
  for (const entry of value) {
    const m = obj(entry);
    const id = m?.id as PosPaymentMethodId | undefined;
    if (!m || !id || !POS_PAYMENT_METHOD_IDS.includes(id)) continue;
    if (lidos.some((l) => l.id === id)) continue;
    lidos.push({
      id,
      enabled: bool(m.enabled, true),
      label: text(m.label, POS_PAYMENT_METHOD_NAMES[id], POS_LIMITS.labelMax),
    });
  }
  if (lidos.length === 0) return fabrica.map((m) => ({ ...m }));
  // Os que faltarem entram no fim, desligados: um meio novo no produto não
  // aparece sozinho numa loja que já escolheu os seus.
  for (const id of POS_PAYMENT_METHOD_IDS) {
    if (!lidos.some((l) => l.id === id)) {
      lidos.push({ id, enabled: false, label: POS_PAYMENT_METHOD_NAMES[id] });
    }
  }
  // A venda nunca pára: sem nenhum meio ligado, o dinheiro volta a estar.
  if (!lidos.some((l) => l.enabled)) {
    const dinheiro = lidos.find((l) => l.id === 'cash');
    if (dinheiro) dinheiro.enabled = true;
  }
  return lidos;
}

function resolveStep(value: unknown, fallback: PosUpsellStepSetting): PosUpsellStepSetting {
  const s = obj(value);
  if (!s) return { ...fallback, scripts: [...fallback.scripts] };
  const scripts = textList(s.scripts, fallback.scripts, POS_LIMITS.scriptsPerStep, POS_LIMITS.scriptMax);
  return {
    enabled: bool(s.enabled, fallback.enabled),
    title: text(s.title, fallback.title, POS_LIMITS.titleMax),
    // Um passo sem frases continua a oferecer — só não sugere o que dizer.
    scripts,
  };
}

/**
 * O jsonb da BD (ou da cache) → definições completas e válidas.
 * Nunca lança: o pior caso é o valor de fábrica.
 */
export function resolvePosSettings(raw: unknown): PosSettings {
  const f = FACTORY_POS_SETTINGS;
  const r = obj(raw) ?? {};
  const payments = obj(r.payments) ?? {};
  const upsell = obj(r.upsell) ?? {};
  const steps = obj(upsell.steps) ?? {};
  const cart = obj(r.cart) ?? {};
  const sale = obj(r.sale) ?? {};
  const alerts = obj(r.alerts) ?? {};

  const fulfillment = cart.defaultFulfillment;
  const segundos = Number(sale.confirmationSeconds);

  return {
    payments: {
      methods: resolveMethods(payments.methods),
      allowMixed: bool(payments.allowMixed, f.payments.allowMixed),
    },
    upsell: {
      enabled: bool(upsell.enabled, f.upsell.enabled),
      steps: {
        companion: resolveStep(steps.companion, f.upsell.steps.companion),
        dessert: resolveStep(steps.dessert, f.upsell.steps.dessert),
      },
    },
    quickNotes: textList(r.quickNotes, f.quickNotes, POS_LIMITS.quickNotes, POS_LIMITS.quickNoteMax),
    cart: {
      defaultFulfillment:
        fulfillment === 'counter' || fulfillment === 'pickup' || fulfillment === 'delivery'
          ? fulfillment
          : f.cart.defaultFulfillment,
      askCustomerOnCounter: bool(cart.askCustomerOnCounter, f.cart.askCustomerOnCounter),
    },
    sale: {
      confirmationSeconds: Number.isFinite(segundos)
        ? Math.min(POS_LIMITS.confirmationMax, Math.max(POS_LIMITS.confirmationMin, Math.round(segundos)))
        : f.sale.confirmationSeconds,
    },
    alerts: {
      newOrderChime: bool(alerts.newOrderChime, f.alerts.newOrderChime),
    },
  };
}

/** Os meios ligados, pela ordem da loja. Nunca vazio. */
export function enabledPaymentMethods(settings: PosSettings): PosPaymentMethodSetting[] {
  const ligados = settings.payments.methods.filter((m) => m.enabled);
  return ligados.length > 0 ? ligados : [{ id: 'cash', enabled: true, label: POS_PAYMENT_METHOD_NAMES.cash }];
}

// ─── leitura da BD ───────────────────────────────────────────────────────────

/** O mínimo do cliente Supabase que isto usa — o módulo não o importa. */
export type PosSettingsRpcClient = {
  rpc: (
    fn: 'get_pos_settings',
    args: { p_store_id: string },
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * As definições da loja, pela RPC `get_pos_settings` (migration 1067).
 * Nunca lança: `null` quer dizer "fica o que já estava" (cache ou fábrica) —
 * uma definição que não chegou não pode parar o balcão (Regra 1).
 */
export async function fetchPosSettings(
  client: PosSettingsRpcClient,
  storeId: string,
): Promise<PosSettings | null> {
  try {
    const { data, error } = await client.rpc('get_pos_settings', { p_store_id: storeId });
    if (error || !data) return null;
    return resolvePosSettings((data as { config?: unknown }).config);
  } catch {
    return null;
  }
}

// ─── cache offline ───────────────────────────────────────────────────────────

const CACHE_PREFIX = 'pos_settings:';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function readCachedPosSettings(storage: StorageLike, storeKey: string): PosSettings | null {
  try {
    const raw = storage.getItem(CACHE_PREFIX + storeKey);
    return raw ? resolvePosSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeCachedPosSettings(storage: StorageLike, storeKey: string, settings: PosSettings): void {
  try {
    storage.setItem(CACHE_PREFIX + storeKey, JSON.stringify(settings));
  } catch {
    // Cache cheia ou bloqueada: o POS continua com o que tem em memória.
  }
}
