import { describe, expect, it } from 'vitest';

import { MPESA_CODES, mpesaMessagePt, readMpesaCode } from '../mpesa/codes';

/**
 * A regra que estes testes protegem é uma só: **"não sei" nunca vira "não
 * pagou"**.
 *
 * Se o sistema decidir que um tempo esgotado é uma falha, a encomenda cai com
 * o dinheiro já cobrado — e quem descobre é o cliente, ao telefone, num
 * sábado à noite.
 */
describe('leitura dos códigos do M-Pesa', () => {
  it('só INS-0 é pagamento feito', () => {
    expect(readMpesaCode('INS-0').outcome).toBe('success');

    const outrosSucessos = Object.entries(MPESA_CODES).filter(
      ([code, entry]) => entry.outcome === 'success' && code !== 'INS-0',
    );
    expect(outrosSucessos).toEqual([]);
  });

  it('tempo esgotado, erro interno e congestão ficam por saber — nunca falhados', () => {
    for (const code of ['INS-9', 'INS-1', 'INS-16', 'INS-23']) {
      expect(readMpesaCode(code).outcome, code).toBe('unknown');
    }
  });

  it('duplicado é "por saber", não é falha nem cobrança nova', () => {
    // INS-10 quer dizer que aquela referência já foi enviada. A resposta certa
    // é ir perguntar o estado da primeira, não cobrar outra vez nem desistir.
    expect(readMpesaCode('INS-10').outcome).toBe('unknown');
  });

  it('um código desconhecido é "por saber", não é falha', () => {
    // O M-Pesa pode devolver amanhã um código que hoje não existe. Se isso
    // desse falha, o primeiro código novo dava encomendas por falhadas com o
    // dinheiro cobrado.
    expect(readMpesaCode('INS-9999').outcome).toBe('unknown');
    expect(readMpesaCode(null).outcome).toBe('unknown');
    expect(readMpesaCode(undefined).outcome).toBe('unknown');
  });

  it('cancelar e saldo insuficiente são falhas de verdade, e dizem-se ao cliente', () => {
    expect(readMpesaCode('INS-5').outcome).toBe('failed');
    expect(readMpesaCode('INS-5').retryable).toBe(true);
    expect(mpesaMessagePt('INS-2006')).toMatch(/[Ss]aldo/);
  });

  it('erro de configuração nosso não vira lição de vida para o cliente', () => {
    // Chave inválida é problema nosso: o cliente recebe a mensagem genérica e
    // quem tem de saber o código é o painel.
    expect(readMpesaCode('INS-2').outcome).toBe('failed');
    expect(mpesaMessagePt('INS-2')).toBe(mpesaMessagePt('INS-9999'));
  });

  it('há sempre mensagem em português, nunca uma string vazia no ecrã', () => {
    for (const code of Object.keys(MPESA_CODES)) {
      expect(mpesaMessagePt(code).length, code).toBeGreaterThan(0);
    }
  });
});
