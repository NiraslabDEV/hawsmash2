import { generateKeyPairSync } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MpesaConfigError, MpesaProvider, type MpesaConfig } from '../mpesa/mpesa-provider';
import { MpesaSimulator } from '../mpesa/simulator';

/**
 * O que estes testes protegem, por ordem de quanto custa errar:
 *
 * 1. Um tempo esgotado **nunca** dá o pagamento por falhado.
 * 2. A mesma referência **nunca** cobra duas vezes.
 * 3. Nada fica à espera para sempre — tudo tem tecto de tempo.
 */

const { publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const config: MpesaConfig = {
  apiKey: 'chave-de-teste',
  publicKey,
  serviceProviderCode: '171717',
  sessionBaseUrl: 'https://mpesa.teste:1001',
  chargeBaseUrl: 'https://mpesa.teste:1002',
  queryBaseUrl: 'https://mpesa.teste:1003',
  chargeTimeoutMs: 1_000,
  shortTimeoutMs: 500,
};

const pedido = {
  amountCents: 45_000,
  msisdn: '258841234567',
  reference: 'PEDIDO0001',
  description: 'Encomenda',
};

/** Respostas encadeadas para o `fetch`, na ordem em que serão pedidas. */
function stubFetch(respostas: Array<{ status?: number; body: unknown } | Error>) {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    const proxima = respostas.shift();
    if (!proxima) throw new Error('fetch inesperado');
    if (proxima instanceof Error) throw proxima;
    return new Response(JSON.stringify(proxima.body), {
      status: proxima.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return chamadas;
}

const sessaoOk = { body: { output_ResponseCode: 'INS-0', output_SessionID: 'sessao-123' } };

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('configuração', () => {
  it('recusa arrancar sem o que é obrigatório, em vez de falhar na cobrança', () => {
    // Descobrir que falta o código do comerciante a meio de uma venda é o
    // pior momento possível para descobrir.
    expect(() => new MpesaProvider({ ...config, serviceProviderCode: '' })).toThrow(
      MpesaConfigError,
    );
    expect(() => new MpesaProvider({ ...config, publicKey: '  ' })).toThrow(/publicKey/);
  });
});

describe('cobrança', () => {
  it('pede sessão, cobra, e devolve pago', async () => {
    const chamadas = stubFetch([
      sessaoOk,
      { body: { output_ResponseCode: 'INS-0', output_TransactionID: 'T123' } },
    ]);

    const resultado = await new MpesaProvider(config).charge(pedido);

    expect(resultado.status).toBe('success');
    expect(resultado.providerRef).toBe('T123');
    expect(chamadas[1].url).toContain('/c2bPayment/singleStage/');

    // O valor vai em decimal, nunca em centavos nem em float.
    const corpo = JSON.parse(String(chamadas[1].init?.body));
    expect(corpo.input_Amount).toBe('450.00');
    expect(corpo.input_CustomerMSISDN).toBe('258841234567');
    // A referência da tentativa é o que impede a dupla cobrança.
    expect(corpo.input_ThirdPartyReference).toBe('PEDIDO0001');
  });

  it('tempo esgotado fica PENDENTE — nunca falhado', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    stubFetch([sessaoOk, timeout]);

    const resultado = await new MpesaProvider(config).charge(pedido);

    // Se isto virasse 'failed', a encomenda caía com o dinheiro já cobrado.
    expect(resultado.status).toBe('pending');
    expect(resultado.code).toBe('timeout');
    expect(resultado.message).toMatch(/confirmar/i);
  });

  it('INS-9 do próprio M-Pesa também fica pendente', async () => {
    stubFetch([sessaoOk, { body: { output_ResponseCode: 'INS-9' } }]);
    const resultado = await new MpesaProvider(config).charge(pedido);
    expect(resultado.status).toBe('pending');
  });

  it('duplicado fica pendente, para se ir perguntar o estado do primeiro', async () => {
    stubFetch([sessaoOk, { body: { output_ResponseCode: 'INS-10' } }]);
    const resultado = await new MpesaProvider(config).charge(pedido);
    expect(resultado.status).toBe('pending');
  });

  it('cancelar e saldo insuficiente são falhas, com mensagem para o cliente', async () => {
    stubFetch([sessaoOk, { body: { output_ResponseCode: 'INS-5' } }]);
    const cancelado = await new MpesaProvider(config).charge(pedido);
    expect(cancelado.status).toBe('failed');
    expect(cancelado.message).toMatch(/[Cc]ancelaste/);

    stubFetch([sessaoOk, { body: { output_ResponseCode: 'INS-2006' } }]);
    const semSaldo = await new MpesaProvider(config).charge(pedido);
    expect(semSaldo.status).toBe('failed');
    expect(semSaldo.message).toMatch(/[Ss]aldo/);
  });

  it('5xx sem corpo do M-Pesa é "não sei", não é recusa', async () => {
    stubFetch([sessaoOk, { status: 503, body: {} }]);
    const resultado = await new MpesaProvider(config).charge(pedido);
    expect(resultado.status).toBe('pending');
  });

  it('a cobrança leva tecto de tempo — nada fica à espera para sempre', async () => {
    const chamadas = stubFetch([
      sessaoOk,
      { body: { output_ResponseCode: 'INS-0', output_TransactionID: 'T1' } },
    ]);
    await new MpesaProvider(config).charge(pedido);
    expect(chamadas[1].init?.signal).toBeDefined();
  });
});

describe('sessão', () => {
  it('reaproveita a sessão entre cobranças — o cliente já está à espera', async () => {
    const chamadas = stubFetch([
      sessaoOk,
      { body: { output_ResponseCode: 'INS-0', output_TransactionID: 'T1' } },
      { body: { output_ResponseCode: 'INS-0', output_TransactionID: 'T2' } },
    ]);

    const provider = new MpesaProvider(config);
    await provider.charge(pedido);
    await provider.charge({ ...pedido, reference: 'PEDIDO0002' });

    const sessoes = chamadas.filter((c) => c.url.includes('/getSession/'));
    expect(sessoes).toHaveLength(1);
  });

  it('renova a sessão uma vez quando o M-Pesa recusa autorização', async () => {
    const chamadas = stubFetch([
      sessaoOk,
      { status: 401, body: {} },
      { body: { output_ResponseCode: 'INS-0', output_SessionID: 'sessao-456' } },
      { body: { output_ResponseCode: 'INS-0', output_TransactionID: 'T9' } },
    ]);

    const resultado = await new MpesaProvider(config).charge(pedido);

    expect(resultado.status).toBe('success');
    expect(chamadas.filter((c) => c.url.includes('/getSession/'))).toHaveLength(2);
  });

  it('não insiste em ciclo com credenciais más', async () => {
    // Repetir sem fim é como se transforma uma chave errada num bloqueio de conta.
    stubFetch([sessaoOk, { status: 401, body: {} }, sessaoOk, { status: 401, body: {} }]);
    const resultado = await new MpesaProvider(config).charge(pedido);
    expect(resultado.status).toBe('pending');
  });
});

describe('consulta de estado', () => {
  it('lê o estado pela referência da tentativa', async () => {
    const chamadas = stubFetch([sessaoOk, { body: { output_ResponseCode: 'INS-0' } }]);
    const estado = await new MpesaProvider(config).getPaymentStatus('PEDIDO0001');

    expect(estado).toBe('success');
    expect(chamadas[1].url).toContain('input_QueryReference=PEDIDO0001');
  });

  it('não conseguir perguntar deixa pendente — não inventa resposta', async () => {
    stubFetch([sessaoOk, new Error('rede em baixo')]);
    expect(await new MpesaProvider(config).getPaymentStatus('PEDIDO0001')).toBe('pending');
  });
});

describe('simulador', () => {
  it('permite ensaiar cada caso pelo último dígito do número', async () => {
    const sim = new MpesaSimulator();

    expect((await sim.charge({ ...pedido, msisdn: '258841234560' })).status).toBe('success');
    expect((await sim.charge({ ...pedido, msisdn: '258841234566' })).status).toBe('failed');
    expect((await sim.charge({ ...pedido, msisdn: '258841234567' })).status).toBe('failed');
    expect((await sim.charge({ ...pedido, msisdn: '258841234568' })).status).toBe('pending');
  });

  it('o que ficou pendente por tempo esgotado tinha sido pago — e a consulta di-lo', async () => {
    // É este o ensaio que interessa: prova que o sistema não perde a venda por
    // não ter recebido a resposta a tempo.
    const sim = new MpesaSimulator();
    const resultado = await sim.charge({
      ...pedido,
      msisdn: '258841234568',
      reference: 'TIMEOUT01',
    });

    expect(resultado.status).toBe('pending');
    expect(await sim.getPaymentStatus('TIMEOUT01')).toBe('success');
  });
});
