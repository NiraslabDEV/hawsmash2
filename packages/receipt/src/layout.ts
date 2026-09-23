/**
 * Como a loja quer o talão — escolhido na aba POS do painel, lido pelo bridge.
 *
 * Não é um editor livre de modelos, de propósito: num papel de 80 mm, um
 * modelo mal feito faz a comanda sair ilegível ou não sair, e "a cozinha a
 * imprimir" é um dos não-negociáveis da abertura (CLAUDE §0). Em vez disso há
 * modelos prontos (desenhados e testados aqui) e interruptores simples. O
 * valor de fábrica é o talão de sempre, byte a byte.
 *
 * Chega ao bridge dentro de `store_pos_settings.config.printing` (1067). Lido
 * sempre com `resolvePrintLayout`: uma chave desconhecida ou estragada cai no
 * valor de fábrica — uma definição nunca deixa a cozinha sem papel.
 */

import type { TicketViaLabel } from './types';

export type TicketTemplate = 'completo' | 'compacto' | 'cozinha';
/** As vias configuráveis. A via única (1 cópia) e a reimpressão usam o modelo da via de controlo. */
export type TicketVia = 'controlo' | 'cliente' | 'cozinha';

export interface PrintLayout {
  /** O modelo de cada via do talão. */
  templates: Record<TicketVia, TicketTemplate>;
  /** Afinam o modelo Completo (os outros modelos têm estes blocos fixos). */
  show: {
    /** Logo da instalação (ou o nome da marca) no topo. */
    logo: boolean;
    /** Morada e telefone da loja por baixo do nome. */
    storeContacts: boolean;
    /** "Obrigado! Bom apetite, Maria!" */
    thanks: boolean;
    /** O QR de avaliação no Google (ou do Instagram) e o texto à volta. */
    qr: boolean;
    /** O rodapé da loja (aba Lojas). */
    footer: boolean;
  };
  /** Artigos em letra alta no modelo Completo. */
  bigItems: boolean;
}

export const TICKET_TEMPLATES: Record<TicketTemplate, { name: string; description: string }> = {
  completo: {
    name: 'Completo',
    description:
      'O talão de sempre: logo, morada, senha, cliente, horário, artigos com preço, totais, pagamento, agradecimento e QR.',
  },
  compacto: {
    name: 'Compacto',
    description:
      'A mesma informação de dinheiro com menos papel: sem logo, morada, agradecimento nem QR, artigos em letra normal.',
  },
  cozinha: {
    name: 'Cozinha',
    description:
      'Só o que a cozinha precisa, em letra grande: senha, tipo, horário, entrega, artigos e notas. Sem preços nem pagamento.',
  },
};

export const TICKET_VIAS: Record<TicketVia, { name: string; where: string }> = {
  controlo: { name: 'Via de controlo', where: 'Sai no balcão e fica na loja. Também é o modelo da via única e da reimpressão.' },
  cliente: { name: 'Via do cliente', where: 'Sai na cozinha e depois vai no saco para o cliente.' },
  cozinha: { name: 'Via da cozinha', where: 'A 3.ª via, só com 3 vias: fica na cozinha.' },
};

export const FACTORY_PRINT_LAYOUT: PrintLayout = {
  templates: { controlo: 'completo', cliente: 'completo', cozinha: 'completo' },
  show: { logo: true, storeContacts: true, thanks: true, qr: true, footer: true },
  bigItems: true,
};

type Loose = Record<string, unknown>;

function obj(value: unknown): Loose | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function template(value: unknown, fallback: TicketTemplate): TicketTemplate {
  return value === 'completo' || value === 'compacto' || value === 'cozinha' ? value : fallback;
}

/** O jsonb gravado → um layout completo e válido. Nunca lança. */
export function resolvePrintLayout(raw: unknown): PrintLayout {
  const f = FACTORY_PRINT_LAYOUT;
  const r = obj(raw) ?? {};
  const t = obj(r.templates) ?? {};
  const s = obj(r.show) ?? {};
  return {
    templates: {
      controlo: template(t.controlo, f.templates.controlo),
      cliente: template(t.cliente, f.templates.cliente),
      cozinha: template(t.cozinha, f.templates.cozinha),
    },
    show: {
      logo: bool(s.logo, f.show.logo),
      storeContacts: bool(s.storeContacts, f.show.storeContacts),
      thanks: bool(s.thanks, f.show.thanks),
      qr: bool(s.qr, f.show.qr),
      footer: bool(s.footer, f.show.footer),
    },
    bigItems: bool(r.bigItems, f.bigItems),
  };
}

/**
 * O modelo com que sai uma via. Sem rótulo (1 cópia) e reimpressão: o da via
 * de controlo. A via alterada substitui a do saco, por isso sai como a do cliente.
 */
export function templateForVia(layout: PrintLayout, via: TicketViaLabel | null | undefined): TicketTemplate {
  if (via === 'cliente' || via === 'cozinha') return layout.templates[via];
  if (via === 'alteracao') return layout.templates.cliente;
  return layout.templates.controlo;
}
