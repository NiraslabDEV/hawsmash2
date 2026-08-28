/**
 * user-data.ts — identificar a venda sem entregar o cliente.
 *
 * A Meta e o Google conseguem atribuir muito mais conversões quando recebem
 * dados de identificação do comprador ("match quality"). O que NÃO se faz é
 * mandar o telefone do cliente em claro para dentro de uma plataforma de
 * publicidade: tudo o que identifica uma pessoa sai daqui em SHA-256, que é
 * exactamente o que as duas APIs esperam receber.
 *
 * As regras de normalização não são estéticas — um hash de "+258 84 123 4567"
 * e outro de "258841234567" são hashes diferentes e nenhum dá match. Por isso
 * a normalização vive num só sítio, testada, em vez de espalhada por chamadas.
 */

import { createHash } from 'node:crypto';

/** Indicativo de Moçambique. Os números locais têm 9 dígitos e começam por 8. */
const MZ_COUNTRY_CODE = '258';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Hash de um valor já normalizado. Vazio → undefined (nunca hash de ''). */
function hash(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return sha256(trimmed);
}

// ── normalização ────────────────────────────────────────────────────────────

/**
 * Telefone em E.164 sem o `+`, como a Meta exige. Aceita o que a equipa e os
 * clientes escrevem de verdade: `84 123 4567`, `+258841234567`, `0841234567`.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // 00258... → 258...
  if (digits.startsWith('00')) digits = digits.slice(2);
  // 0 84... (hábito local) → 84...
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  // 9 dígitos = número moçambicano sem indicativo
  if (digits.length === 9) digits = MZ_COUNTRY_CODE + digits;

  // Menos de 11 dígitos não é um número internacional válido — melhor não
  // enviar nada do que enviar um hash que nunca vai dar match.
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** Nomes: minúsculas, sem acentos, sem pontuação — regra da Meta. */
export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = raw
    .normalize('NFD') // separa a letra do acento para o poder remover
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return name || null;
}

/** Separa "Ridwan Nissar" em primeiro e último nome, como a CAPI pede. */
export function splitName(full: string | null | undefined): { fn: string | null; ln: string | null } {
  if (!full) return { fn: null, ln: null };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fn: null, ln: null };
  if (parts.length === 1) return { fn: normalizeName(parts[0]), ln: null };
  return { fn: normalizeName(parts[0]), ln: normalizeName(parts[parts.length - 1]) };
}

// ── cookies de clique ───────────────────────────────────────────────────────

/**
 * `fbc` é o cookie que liga esta compra ao clique no anúncio. Quando o browser
 * não o gravou (bloqueador, primeira visita sem JS) reconstrói-se a partir do
 * `fbclid` que ficou guardado na atribuição — é o formato documentado
 * `fb.<subdomainIndex>.<timestamp>.<fbclid>`.
 */
export function buildFbc(fbclid: string | null | undefined, clickTimeMs?: number): string | null {
  if (!fbclid) return null;
  const ts = clickTimeMs && Number.isFinite(clickTimeMs) ? Math.floor(clickTimeMs) : Date.now();
  return `fb.1.${ts}.${fbclid}`;
}

/** O `_fbp` só vale se tiver o formato certo — enviar lixo baixa o match. */
export function sanitizeFbp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /^fb\.\d\.\d+\.\d+$/.test(raw.trim()) ? raw.trim() : null;
}

/** IPv4/IPv6 do primeiro salto do `x-forwarded-for`. */
export function firstForwardedIp(header: string | null | undefined): string | null {
  if (!header) return null;
  const ip = header.split(',')[0]?.trim();
  if (!ip) return null;
  // Endereços locais não ajudam a Meta a identificar ninguém.
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return null;
  return ip.slice(0, 60);
}

// ── construção do bloco user_data ───────────────────────────────────────────

export interface UserDataInput {
  phone?: string | null;
  email?: string | null;
  fullName?: string | null;
  city?: string | null;
  fbp?: string | null;
  fbclid?: string | null;
  clickTimeMs?: number;
  clientIp?: string | null;
  userAgent?: string | null;
}

export interface MetaUserData {
  ph?: string[];
  em?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  country?: string[];
  external_id?: string[];
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

/**
 * Monta o `user_data` da Meta CAPI. Cada campo é opcional de propósito: a
 * Meta faz match com o que houver, e um pedido de balcão sem email não deve
 * impedir o envio do resto.
 */
export function buildMetaUserData(input: UserDataInput): MetaUserData {
  const out: MetaUserData = {};

  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const { fn, ln } = splitName(input.fullName);
  const city = normalizeName(input.city);

  const phoneHash = hash(phone);
  if (phoneHash) {
    out.ph = [phoneHash];
    // O telefone é a identidade do cliente neste negócio (é a chave de
    // `customers`), por isso serve também de external_id estável.
    out.external_id = [phoneHash];
  }
  const emailHash = hash(email);
  if (emailHash) out.em = [emailHash];
  const fnHash = hash(fn);
  if (fnHash) out.fn = [fnHash];
  const lnHash = hash(ln);
  if (lnHash) out.ln = [lnHash];
  const cityHash = hash(city);
  if (cityHash) out.ct = [cityHash];
  if (phone || email) out.country = [sha256('mz')];

  const fbp = sanitizeFbp(input.fbp);
  if (fbp) out.fbp = fbp;

  const fbc = buildFbc(input.fbclid, input.clickTimeMs);
  if (fbc) out.fbc = fbc;

  if (input.clientIp) out.client_ip_address = input.clientIp;
  if (input.userAgent) out.client_user_agent = input.userAgent.slice(0, 400);

  return out;
}

/** Quantos sinais de identificação vão nesta conversão (0–8). Vai para o log. */
export function matchQualityScore(userData: MetaUserData): number {
  const signals: Array<unknown> = [
    userData.ph, userData.em, userData.fn, userData.ln,
    userData.ct, userData.fbp, userData.fbc, userData.client_ip_address,
  ];
  return signals.filter(Boolean).length;
}
