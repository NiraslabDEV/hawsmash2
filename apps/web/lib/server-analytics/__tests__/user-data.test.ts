/**
 * 1030 — normalização e hashing dos dados de identificação da conversão.
 *
 * Estes testes existem porque um erro aqui é invisível: a Meta aceita o
 * payload, responde 200, e simplesmente não faz match com ninguém. O hash de
 * "+258 84 123 4567" e o de "258841234567" são diferentes e nenhum dá erro.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildFbc,
  buildMetaUserData,
  firstForwardedIp,
  matchQualityScore,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  sanitizeFbp,
  splitName,
} from '../user-data';

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

describe('normalizePhone — números moçambicanos como as pessoas os escrevem', () => {
  it('junta todas as formas do mesmo número no mesmo E.164', () => {
    const esperado = '258841234567';
    expect(normalizePhone('841234567')).toBe(esperado);
    expect(normalizePhone('84 123 4567')).toBe(esperado);
    expect(normalizePhone('+258 84 123 4567')).toBe(esperado);
    expect(normalizePhone('00258841234567')).toBe(esperado);
    expect(normalizePhone('0841234567')).toBe(esperado);
  });

  it('recusa o que não é número em vez de enviar um hash que nunca dá match', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('sem telefone')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('minúsculas e sem espaços', () => {
    expect(normalizeEmail('  Ridwan@Example.COM ')).toBe('ridwan@example.com');
  });

  it('recusa o que não é email', () => {
    expect(normalizeEmail('nao-e-email')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe('normalizeName / splitName', () => {
  it('tira acentos e pontuação, como a Meta exige', () => {
    expect(normalizeName('José-António')).toBe('joseantonio');
    expect(normalizeName('  Nissar ')).toBe('nissar');
    expect(normalizeName('123')).toBeNull();
  });

  it('separa o primeiro e o último nome', () => {
    expect(splitName('Ridwan Nissar')).toEqual({ fn: 'ridwan', ln: 'nissar' });
    expect(splitName('Ridwan da Silva Nissar')).toEqual({ fn: 'ridwan', ln: 'nissar' });
    expect(splitName('Ridwan')).toEqual({ fn: 'ridwan', ln: null });
    expect(splitName(null)).toEqual({ fn: null, ln: null });
  });
});

describe('buildFbc / sanitizeFbp', () => {
  it('reconstrói o fbc no formato documentado', () => {
    expect(buildFbc('IwAR-abc', 1_700_000_000_000)).toBe('fb.1.1700000000000.IwAR-abc');
  });

  it('sem fbclid não inventa um fbc', () => {
    expect(buildFbc(null)).toBeNull();
    expect(buildFbc('')).toBeNull();
  });

  it('_fbp com formato errado é descartado', () => {
    expect(sanitizeFbp('fb.1.1700000000000.1234567890')).toBe('fb.1.1700000000000.1234567890');
    expect(sanitizeFbp('lixo')).toBeNull();
    expect(sanitizeFbp(null)).toBeNull();
  });
});

describe('firstForwardedIp', () => {
  it('fica com o primeiro salto', () => {
    expect(firstForwardedIp('197.218.1.1, 10.0.0.1')).toBe('197.218.1.1');
  });

  it('ignora endereços locais — não identificam ninguém', () => {
    expect(firstForwardedIp('127.0.0.1')).toBeNull();
    expect(firstForwardedIp('192.168.1.4')).toBeNull();
    expect(firstForwardedIp(null)).toBeNull();
  });
});

describe('buildMetaUserData', () => {
  it('põe cada campo em SHA-256 do valor normalizado', () => {
    const ud = buildMetaUserData({
      phone: '+258 84 123 4567',
      email: 'Ridwan@Example.com',
      fullName: 'Ridwan Nissar',
    });

    expect(ud.ph).toEqual([sha('258841234567')]);
    expect(ud.em).toEqual([sha('ridwan@example.com')]);
    expect(ud.fn).toEqual([sha('ridwan')]);
    expect(ud.ln).toEqual([sha('nissar')]);
    expect(ud.country).toEqual([sha('mz')]);
  });

  it('o telefone é a identidade do cliente, logo serve de external_id', () => {
    const ud = buildMetaUserData({ phone: '841234567' });
    expect(ud.external_id).toEqual(ud.ph);
  });

  it('um pedido sem email nem nome envia o que houver, sem campos vazios', () => {
    const ud = buildMetaUserData({ phone: '841234567' });
    expect(ud.ph).toBeDefined();
    expect(ud.em).toBeUndefined();
    expect(ud.fn).toBeUndefined();
  });

  it('sem dado nenhum devolve objecto vazio em vez de hashes de string vazia', () => {
    expect(buildMetaUserData({})).toEqual({});
  });

  it('conta os sinais de identificação para o log', () => {
    const forte = buildMetaUserData({
      phone: '841234567',
      email: 'a@b.com',
      fullName: 'Ridwan Nissar',
      fbp: 'fb.1.1700000000000.1',
      fbclid: 'abc',
      clientIp: '197.218.1.1',
    });
    expect(matchQualityScore(forte)).toBeGreaterThanOrEqual(6);
    expect(matchQualityScore(buildMetaUserData({}))).toBe(0);
  });
});
