import { describe, expect, it } from 'vitest';

import {
  FACTORY_PRINT_LAYOUT,
  buildFullTicket,
  encodeEscPos,
  renderPreview,
  resolvePrintLayout,
  sampleTicket,
  templateForVia,
  type Op,
  type PrintLayout,
} from '../index';

const loja = {
  shortName: 'Centro',
  address: 'Rua da Loja 7',
  phone: '84 111 1111',
  footer: 'NUIT 000000000',
  reviewUrl: 'https://g.page/r/exemplo/review',
  instagram: '@marca',
  instagramUrl: 'https://instagram.com/marca',
};

/** O texto que o papel leva, sem estilos — para perguntar "isto sai?". */
function texto(ops: Op[]): string {
  return ops
    .filter((op): op is Extract<Op, { t: 'text' }> => op.t === 'text')
    .map((op) => op.value)
    .join('');
}

const tem = (ops: Op[], t: Op['t']) => ops.some((op) => op.t === t);

type LayoutParcial = Omit<Partial<PrintLayout>, 'show'> & { show?: Partial<PrintLayout['show']> };

function layout(parcial: LayoutParcial = {}): PrintLayout {
  return resolvePrintLayout({ ...FACTORY_PRINT_LAYOUT, ...parcial, show: { ...FACTORY_PRINT_LAYOUT.show, ...parcial.show } });
}

describe('layout do talão — leitura tolerante', () => {
  it('sem nada gravado, ou com lixo, é o de fábrica', () => {
    expect(resolvePrintLayout(null)).toEqual(FACTORY_PRINT_LAYOUT);
    expect(resolvePrintLayout('x')).toEqual(FACTORY_PRINT_LAYOUT);
    expect(resolvePrintLayout({ templates: { cliente: 'inventado' }, show: { qr: 'sim' } })).toEqual(
      FACTORY_PRINT_LAYOUT,
    );
  });

  it('um campo estragado não leva os outros', () => {
    const l = resolvePrintLayout({ templates: { cliente: 'cozinha', controlo: 7 }, show: { logo: false }, bigItems: 'x' });
    expect(l.templates).toEqual({ controlo: 'completo', cliente: 'cozinha', cozinha: 'completo' });
    expect(l.show.logo).toBe(false);
    expect(l.show.qr).toBe(true);
    expect(l.bigItems).toBe(true);
  });

  it('a via única e a reimpressão usam o modelo da via de controlo', () => {
    const l = layout({ templates: { controlo: 'compacto', cliente: 'cozinha', cozinha: 'cozinha' } });
    expect(templateForVia(l, null)).toBe('compacto');
    expect(templateForVia(l, 'reimpressao')).toBe('compacto');
    expect(templateForVia(l, 'cliente')).toBe('cozinha');
  });

  it('a via alterada usa o modelo da via do cliente — é a que substitui a do saco', () => {
    const l = layout({ templates: { controlo: 'compacto', cliente: 'cozinha', cozinha: 'completo' } });
    expect(templateForVia(l, 'alteracao')).toBe('cozinha');
  });
});

describe('modelos do talão', () => {
  const pedido = sampleTicket({ store: loja, via: 'cliente' });

  it('Completo (fábrica) leva tudo', () => {
    const ops = buildFullTicket(pedido);
    const t = texto(ops);
    for (const trecho of ['RUA DA LOJA 7', 'VIA DO CLIENTE', 'SENHA', 'TOTAL:', '[ PAGO VIA M-PESA ]', 'Obrigado!', 'NUIT']) {
      expect(t.toUpperCase(), trecho).toContain(trecho.toUpperCase());
    }
    expect(tem(ops, 'brand')).toBe(true);
    expect(tem(ops, 'qr')).toBe(true);
    expect(ops).toContainEqual({ t: 'size', value: 'tall' });
  });

  it('Cozinha não leva preços nem pagamento, e põe os artigos a dobrar', () => {
    const ops = buildFullTicket(pedido, layout({ templates: { controlo: 'completo', cliente: 'cozinha', cozinha: 'completo' } }));
    const t = texto(ops);
    expect(t).toContain('*** VIA DO CLIENTE ***');
    expect(t).toContain('SENHA');
    expect(t).toContain('HORARIO:');
    expect(t).toContain('** ENTREGA **');
    expect(t).toContain('NOTA: SEM CEBOLA, SEM');
    expect(t).toContain('NOTA DO PEDIDO: Tocar');
    for (const fora of ['TOTAL', 'Subtotal', 'PAGO', 'Obrigado', 'NUIT', ' MT']) expect(t, fora).not.toContain(fora);
    expect(tem(ops, 'qr')).toBe(false);
    expect(tem(ops, 'brand')).toBe(false);
    expect(ops).toContainEqual({ t: 'size', value: 'double' });
  });

  it('Compacto guarda o dinheiro e poupa o resto', () => {
    const ops = buildFullTicket(pedido, layout({ templates: { controlo: 'completo', cliente: 'compacto', cozinha: 'completo' } }));
    const t = texto(ops);
    expect(t).toContain('TOTAL:');
    expect(t).toContain('[ PAGO VIA M-PESA ]');
    expect(t).toContain('NUIT');
    expect(t).not.toContain('Obrigado');
    expect(t).not.toContain('Rua da Loja 7');
    expect(tem(ops, 'brand')).toBe(false);
    expect(tem(ops, 'qr')).toBe(false);
    expect(ops).not.toContainEqual({ t: 'size', value: 'tall' });
  });

  it('os interruptores tiram só o seu bloco do Completo', () => {
    const semQr = buildFullTicket(pedido, layout({ show: { qr: false } }));
    expect(tem(semQr, 'qr')).toBe(false);
    expect(texto(semQr)).toContain('Obrigado!');

    const semLogo = buildFullTicket(pedido, layout({ show: { logo: false } }));
    expect(tem(semLogo, 'brand')).toBe(false);
    expect(texto(semLogo)).toContain('CENTRO');

    const semContactos = texto(buildFullTicket(pedido, layout({ show: { storeContacts: false } })));
    expect(semContactos).not.toContain('Rua da Loja 7');
    expect(semContactos).not.toContain('84 111 1111');

    const semAgradecer = texto(buildFullTicket(pedido, layout({ show: { thanks: false } })));
    expect(semAgradecer).not.toContain('Bom apetite');
    expect(semAgradecer).toContain('pode avaliar-nos no Google?');

    expect(texto(buildFullTicket(pedido, layout({ show: { footer: false } })))).not.toContain('NUIT');
    expect(buildFullTicket(pedido, layout({ bigItems: false }))).not.toContainEqual({ t: 'size', value: 'tall' });
  });

  it('todos os modelos acabam com o avanço e o corte', () => {
    for (const modelo of ['completo', 'compacto', 'cozinha'] as const) {
      const ops = buildFullTicket(pedido, layout({ templates: { controlo: modelo, cliente: modelo, cozinha: modelo } }));
      expect(ops.slice(-2)).toEqual([{ t: 'feed', lines: 6 }, { t: 'cut' }]);
    }
  });
});

describe('pré-visualização e bytes a partir das mesmas instruções', () => {
  const ops = buildFullTicket(sampleTicket({ store: loja, via: 'controlo' }));

  it('a pré-visualização tem o logo, a senha, o QR e o corte', () => {
    const linhas = renderPreview(ops);
    expect(linhas[0]).toEqual({ kind: 'brand', align: 'center' });
    const senha = linhas.find(
      (l) => l.kind === 'text' && l.spans.some((s) => s.text === '42' && s.size === 'triple'),
    );
    expect(senha).toBeTruthy();
    expect(linhas.some((l) => l.kind === 'qr' && l.data === loja.reviewUrl)).toBe(true);
    expect(linhas.at(-1)).toEqual({ kind: 'cut' });
    // 48 colunas: nenhuma linha em letra normal passa da largura do papel.
    for (const l of linhas) {
      if (l.kind !== 'text' || l.spans.some((s) => s.size !== 'normal' && s.size !== 'tall')) continue;
      expect(l.spans.map((s) => s.text).join('').length).toBeLessThanOrEqual(48);
    }
  });

  it('os bytes começam pela inicialização CP1252 e acabam no corte', () => {
    const bytes = encodeEscPos(ops);
    expect(Array.from(bytes.slice(0, 7))).toEqual([0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 16]);
    expect(Array.from(bytes.slice(-3))).toEqual([0x1d, 0x56, 0x00]);
  });

  it('sem logo, o nome da marca sai em corpo triplo; sem nenhum, só a loja', () => {
    const cabecalho = buildFullTicket(sampleTicket({ store: loja, via: null })).slice(0, 3);
    const comNome = Array.from(encodeEscPos(cabecalho, { brandName: 'Marca' }));
    expect(comNome).toEqual(expect.arrayContaining([0x1d, 0x21, 0x22]));
    expect(String.fromCharCode(...comNome)).toContain('MARCA\n');
    const semNada = Array.from(encodeEscPos(cabecalho));
    expect(String.fromCharCode(...semNada)).not.toContain('MARCA');
  });

  it('acentos em CP1252', () => {
    expect(Array.from(encodeEscPos([{ t: 'text', value: 'ção€' }]))).toEqual([0xe7, 0xe3, 0x6f, 0x80]);
  });
});
