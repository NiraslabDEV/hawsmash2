import { LOGO_RASTER } from './logo.js';

// ESC/POS para RONGTA RP326 (80mm, ESC/POS, CP1252). Bytes montados à mão.
//
// DECISÃO: não usamos libs como `esc-pos-encoder` (arrastam `canvas`/Cairo,
// pesado e quebra em Windows). Montamos os bytes directamente — controlo total
// de codepage, tamanho de fonte e corte.
//
// Acentos: seleccionamos a CP1252 (WPC1252) na impressora e codificamos o texto
// como bytes 0–255, que coincidem com a CP1252 para todos os acentos do
// português (á à â ã ç é ê í ó ô õ ú …). Typográficos (– — “ ” …) via tabela.

const ESC = 0x1b;
const GS = 0x1d;

// 80mm em Fonte A = 48 colunas. Configurável por env (algumas variantes diferem).
const WIDTH = parseInt(process.env.RECEIPT_WIDTH || '48', 10);

const INIT = Buffer.from([ESC, 0x40]); // ESC @  → reset
// FS .  → cancela o modo Kanji/chinês. ESSENCIAL nas térmicas chinesas (Xprinter
// XP-T80Q tem "Chinese character: Yes"): sem isto, os bytes ≥0x80 (acentos PT)
// são lidos como início de um caractere chinês de duplo-byte → sai lixo (月敨…).
const CANCEL_KANJI = Buffer.from([0x1c, 0x2e]); // FS .
const CODEPAGE_CP1252 = Buffer.from([ESC, 0x74, 16]); // ESC t 16 → WPC1252 (Latin-1)
const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0]); // ESC a 0
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 1]); // ESC a 1
const BOLD_ON = Buffer.from([ESC, 0x45, 1]); // ESC E 1
const BOLD_OFF = Buffer.from([ESC, 0x45, 0]); // ESC E 0
const SIZE_NORMAL = Buffer.from([GS, 0x21, 0x00]); // GS ! 0
const SIZE_DOUBLE = Buffer.from([GS, 0x21, 0x11]); // GS ! 0x11 → largura+altura ×2
const SIZE_TRIPLE = Buffer.from([GS, 0x21, 0x22]); // GS ! 0x22 → largura+altura ×3 (cabeçalho)
const SIZE_DBL_H = Buffer.from([GS, 0x21, 0x01]); // GS ! 0x01 → só altura ×2 (itens — mantém 48 col)
export const CUT_FULL = Buffer.from([GS, 0x56, 0x00]); // GS V 0 → corte total

// Caracteres CP1252 0x80–0x9F que NÃO coincidem com latin1 (typográficos, €…).
const CP1252_EXTRA = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
const CP1252_REVERSE = Object.fromEntries(
  Object.entries(CP1252_EXTRA).map(([ch, b]) => [b, ch]),
);

function text(str) {
  // Code points 0–255 → byte directo (acentos PT). Typográficos → byte CP1252.
  // Fora disso → '?' (a térmica não renderiza esses glifos).
  const bytes = [];
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) bytes.push(cp);
    else bytes.push(CP1252_EXTRA[ch] ?? 0x3f);
  }
  return Buffer.from(bytes);
}
function line(str = '') {
  return Buffer.concat([text(str), Buffer.from('\n', 'latin1')]);
}
function feed(n) {
  return Buffer.from([ESC, 0x64, n]); // ESC d n → avança n linhas
}

// Link de avaliação no Google (negócio HAWSMASH).
const REVIEW_URL = 'https://g.page/r/CQI_-WS6UUKyEAE/review';

// QR code nativo ESC/POS (GS ( k, modelo 2). A Xprinter XP-T80Q suporta
// QRCODE (ver self-test). `size` = tamanho do módulo em pontos (1–16); 5 = pequeno
// mas legível. Imprime onde o cursor estiver (usar ALIGN_CENTER antes).
function qrCode(data, size = 5, ecLevel = 0x31 /* M */) {
  const bytes = Buffer.from(String(data), 'latin1');
  const storeLen = bytes.length + 3;
  return Buffer.concat([
    Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]), // modelo 2
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]), // tamanho do módulo
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ecLevel]), // correcção de erro
    Buffer.from([0x1d, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30]), // dados
    bytes,
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]), // imprimir
  ]);
}

// ── Helpers de layout ──
function rule(ch = '=') {
  return ch.repeat(WIDTH);
}
// Coluna esquerda + coluna direita alinhada à direita; trunca a esquerda se preciso.
function twoCol(left, right, width = WIDTH) {
  left = String(left);
  right = String(right);
  const maxLeft = width - right.length - 1; // garante ≥1 espaço
  if (left.length > maxLeft) left = left.slice(0, Math.max(0, maxLeft));
  const pad = width - left.length - right.length;
  return left + ' '.repeat(Math.max(1, pad)) + right;
}
// Quebra texto longo (morada, notas) em várias linhas até `width`.
function wrap(str, width = WIDTH) {
  const out = [];
  let cur = '';
  for (let word of String(str).split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (cur) { out.push(cur); cur = ''; }
      out.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= width) cur += ' ' + word;
    else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function formatMT(n) {
  return `${Number(n) || 0} MT`;
}

function orderRef(order) {
  if (order.order_number != null) return `HS-${String(order.order_number).padStart(4, '0')}`;
  return `HS-${String(order.id || '').slice(0, 8).toUpperCase()}`;
}

function fmtDateTime(iso) {
  if (!iso) return '';
  try {
    const f = new Intl.DateTimeFormat('pt-PT', {
      timeZone: 'Africa/Maputo',
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
  } catch {
    return '';
  }
}

function fulfillmentLabel(f) {
  if (f === 'delivery') return '** ENTREGA **';
  if (f === 'yango') return '** ENTREGA · YANGO **';
  if (f === 'pickup') return '** LEVANTAMENTO **';
  return `** ${String(f || '').toUpperCase()} **`;
}

function slotLabel(order) {
  const w = String(order.slot_window || '').trim();
  if (/agora/i.test(w)) return 'AGORA';
  return [order.slot_date, w].filter(Boolean).join(' · ');
}

function paymentLabel(method) {
  const m = String(method || '').toLowerCase();
  if (m === 'mpesa') return '[ PAGO VIA M-PESA ]';
  if (m === 'emola') return '[ PAGO VIA E-MOLA ]';
  return `[ PAGO VIA ${String(method || '').toUpperCase()} ]`;
}

// Primeiro nome, capitalizado (ex.: "MARIA ALBERTINA" → "Maria", "joão silva" → "João").
function firstName(full) {
  const w = String(full || '').trim().split(/\s+/)[0] || '';
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '';
}

/**
 * Monta o cupom ESC/POS (80mm) de um pedido HAWSMASH.
 * Aceita um `order` com `order_items` (do Supabase) ou `items`.
 */
export function buildReceipt(order) {
  const items = order.order_items || order.items || [];
  const c = [];

  c.push(INIT, CANCEL_KANJI, CODEPAGE_CP1252);

  // Cabeçalho
  c.push(ALIGN_CENTER);
  if (LOGO_RASTER && LOGO_RASTER.length) c.push(LOGO_RASTER, feed(1));
  else c.push(BOLD_ON, SIZE_TRIPLE, line('HAWSMASH'), SIZE_NORMAL, BOLD_OFF);
  c.push(line('Av. 24 de Julho, 141, Maputo'));
  c.push(line('Tel: 86 076 0009 / 87 090 9080'));
  c.push(line('www.hawsmash.com'));
  c.push(ALIGN_LEFT, line(rule('=')));

  // Pedido + data/hora
  c.push(line(twoCol(`PEDIDO: ${orderRef(order)}`, fmtDateTime(order.created_at))));
  c.push(line(rule('=')));

  // Cliente (destaque)
  c.push(BOLD_ON, line(`CLIENTE: ${String(order.customer_name || '').toUpperCase()}`), BOLD_OFF);
  if (order.customer_phone) c.push(line(`TEL: ${order.customer_phone}`));
  c.push(line(rule('=')));

  // Tipo de entrega
  c.push(BOLD_ON, line(fulfillmentLabel(order.fulfillment)), BOLD_OFF);
  if (order.fulfillment === 'delivery' || order.fulfillment === 'yango') {
    if (order.delivery_zone) c.push(line(`Zona: ${order.delivery_zone}`));
    if (order.delivery_address) {
      for (const l of wrap(`Morada: ${order.delivery_address}`)) c.push(line(l));
    }
  } else {
    c.push(line('Levantamento no balcao'));
  }
  // Horário — GRANDE e bem visível (pedidos chegam para horas diferentes)
  const win = String(order.slot_window || '').trim();
  const horaBig = /agora/i.test(win) ? 'AGORA' : (win || slotLabel(order));
  c.push(line('HORARIO:'));
  c.push(SIZE_DOUBLE, BOLD_ON, line(horaBig), BOLD_OFF, SIZE_NORMAL);
  if (order.slot_date && !/agora/i.test(win)) c.push(line(`Dia: ${order.slot_date}`));
  c.push(line(rule('=')));

  // Itens
  c.push(line(twoCol('Descricao', 'Total')));
  c.push(line(rule('-')));
  for (const it of items) {
    const qty = it.qty ?? it.quantity ?? 1;
    const name = it.product_name ?? it.name ?? '';
    // Itens em altura dupla + negrito → a cozinha lê de relance o que preparar.
    c.push(BOLD_ON, SIZE_DBL_H, line(twoCol(`${qty}x ${name}`, formatMT(it.line_total_mt))), SIZE_NORMAL, BOLD_OFF);
  }
  c.push(line(rule('=')));

  // Nota do cliente (se houver) — importante para a cozinha
  const notes = String(order.customer_notes || '').trim();
  if (notes) {
    c.push(BOLD_ON, line('** NOTA DO CLIENTE **'), BOLD_OFF);
    for (const l of wrap(notes)) c.push(line(l));
    c.push(line(rule('=')));
  }

  // Totais
  c.push(line(twoCol('Subtotal:', formatMT(order.subtotal_mt))));
  if ((order.delivery_fee_mt ?? 0) > 0) {
    c.push(line(twoCol('Taxa de entrega:', formatMT(order.delivery_fee_mt))));
  }
  c.push(line(rule('=')));
  c.push(SIZE_DOUBLE, BOLD_ON, line(`TOTAL: ${formatMT(order.total_mt)}`), BOLD_OFF, SIZE_NORMAL);
  c.push(line(rule('=')));

  // Pagamento (sempre pago — só imprimimos pedidos aprovados)
  c.push(ALIGN_CENTER, BOLD_ON, line(paymentLabel(order.payment_method)), BOLD_OFF);
  c.push(line(rule('=')));

  // Rodapé personalizado (fala com o cliente pelo primeiro nome)
  const nome = firstName(order.customer_name);
  c.push(BOLD_ON, line(nome ? `Obrigado! Bom apetite, ${nome}!` : 'Obrigado! Bom apetite!'), BOLD_OFF);
  c.push(feed(1));
  c.push(line(nome ? `${nome}, pode avaliar-nos no Google?` : 'Pode avaliar-nos no Google?'));
  c.push(line('Vai fazer muita diferença para nós.'));
  c.push(line('Scaneia rapidinho o QR code:'));
  c.push(feed(1));
  c.push(qrCode(REVIEW_URL, 5));
  c.push(feed(1));
  c.push(line(nome ? `Obrigado mais uma vez, ${nome}. Até à próxima!` : 'Obrigado mais uma vez. Até à próxima!'));
  c.push(feed(1));
  c.push(line('Siga-nos no Instagram:'));
  c.push(BOLD_ON, line('@hawsmash'), BOLD_OFF);

  c.push(ALIGN_LEFT, feed(4), CUT_FULL);
  return Buffer.concat(c);
}

/** Cupom de teste (botão "Imprimir teste" do admin). */
export function buildTestReceipt() {
  const c = [];
  c.push(INIT, CANCEL_KANJI, CODEPAGE_CP1252);
  c.push(ALIGN_CENTER);
  if (LOGO_RASTER && LOGO_RASTER.length) c.push(LOGO_RASTER, feed(1));
  else c.push(BOLD_ON, SIZE_TRIPLE, line('HAWSMASH'), SIZE_NORMAL, BOLD_OFF);
  c.push(line(rule('=')));
  c.push(SIZE_DOUBLE, BOLD_ON, line('TESTE'), BOLD_OFF, SIZE_NORMAL);
  c.push(line('Impressora configurada!'));
  c.push(feed(1), line(fmtDateTime(new Date().toISOString())));
  c.push(ALIGN_LEFT, line(rule('=')), feed(4), CUT_FULL);
  return Buffer.concat(c);
}

/** Cupom de fecho de caixa (botão "Imprimir na impressora" do admin). */
export function buildCaixaReceipt(cx) {
  const c = [];
  c.push(INIT, CANCEL_KANJI, CODEPAGE_CP1252);
  c.push(ALIGN_CENTER);
  if (LOGO_RASTER && LOGO_RASTER.length) c.push(LOGO_RASTER, feed(1));
  else c.push(BOLD_ON, SIZE_TRIPLE, line('HAWSMASH'), SIZE_NORMAL, BOLD_OFF);
  c.push(ALIGN_LEFT, line(rule('=')));

  c.push(ALIGN_CENTER, SIZE_DOUBLE, BOLD_ON, line('FECHO DE CAIXA'), BOLD_OFF, SIZE_NORMAL, ALIGN_LEFT);
  c.push(line(rule('=')));
  c.push(line(`Data: ${cx.data || ''}`));
  c.push(line(`Impresso: ${fmtDateTime(new Date().toISOString())}`));
  c.push(line(rule('=')));

  c.push(line(twoCol('Pedidos:', String(cx.total_pedidos ?? 0))));
  c.push(line(twoCol('Entregues:', String(cx.total_entregues ?? 0))));
  if (cx.total_cancelados != null) c.push(line(twoCol('Cancelados:', String(cx.total_cancelados))));
  c.push(line(rule('=')));

  c.push(line(twoCol('M-Pesa:', formatMT(cx.total_mpesa_mt))));
  c.push(line(twoCol('e-Mola:', formatMT(cx.total_emola_mt))));
  c.push(line(rule('=')));
  c.push(SIZE_DOUBLE, BOLD_ON, line(`TOTAL: ${formatMT(cx.total_mt)}`), BOLD_OFF, SIZE_NORMAL);
  c.push(line(rule('=')));

  const itens = Array.isArray(cx.itens) ? cx.itens : [];
  if (itens.length) {
    c.push(BOLD_ON, line('ITENS VENDIDOS'), BOLD_OFF, line(rule('-')));
    for (const it of itens) c.push(line(twoCol(`${it.qty}x ${it.product_name}`, formatMT(it.total_mt))));
    c.push(line(rule('=')));
  }
  if (cx.notas && String(cx.notas).trim()) {
    c.push(BOLD_ON, line('NOTAS'), BOLD_OFF);
    for (const l of wrap(String(cx.notas).trim())) c.push(line(l));
    c.push(line(rule('=')));
  }

  c.push(feed(4), CUT_FULL);
  return Buffer.concat(c);
}

/**
 * Descodifica um buffer ESC/POS em texto legível (usado pelo simulador para
 * mostrar o cupom na consola sem hardware).
 */
export function decodeReceipt(buffer) {
  let out = '';
  let i = 0;
  while (i < buffer.length) {
    const b = buffer[i];
    if (b === ESC) {
      const cmd = buffer[i + 1];
      if (cmd === 0x40) i += 2; // ESC @
      else if (cmd === 0x74 || cmd === 0x61 || cmd === 0x45 || cmd === 0x64) i += 3; // ESC t/a/E/d
      else i += 2;
      continue;
    }
    if (b === GS) {
      const cmd = buffer[i + 1];
      if (cmd === 0x28) { // GS ( k (QR code) — comprimento em pL,pH
        const len = (buffer[i + 3] ?? 0) + (buffer[i + 4] ?? 0) * 256;
        i += 5 + len;
      } else if (cmd === 0x76) { // GS v 0 (raster do logo): 1D 76 30 m xL xH yL yH data
        const xBytes = (buffer[i + 4] ?? 0) + (buffer[i + 5] ?? 0) * 256;
        const yRows = (buffer[i + 6] ?? 0) + (buffer[i + 7] ?? 0) * 256;
        i += 8 + xBytes * yRows;
      } else if (cmd === 0x21 || cmd === 0x56) i += 3; // GS ! / GS V
      else i += 2;
      continue;
    }
    if (b === 0x1c) { // FS . / FS & (modo Kanji) — 2 bytes
      i += 2;
      continue;
    }
    out += CP1252_REVERSE[b] ?? Buffer.from([b]).toString('latin1');
    i += 1;
  }
  return out;
}
