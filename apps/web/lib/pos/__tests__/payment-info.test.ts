import { describe, expect, it } from 'vitest';
import {
  EMPTY_PAYMENT_INFO,
  formatMobileNumber,
  parsePaymentInfo,
  paymentInstructions,
  readCachedPaymentInfo,
  writeCachedPaymentInfo,
} from '../payment-info';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  } as Storage;
}

describe('números de pagamento da loja no POS', () => {
  it('normaliza o que vem da BD escrito à mão', () => {
    const info = parsePaymentInfo({
      mpesa_number: '+258 84 795 5382',
      mpesa_name: '  Soeil Nissar  ',
      emola_number: '870909080',
      emola_name: '',
    });

    expect(info.mpesaNumber).toBe('847955382');
    expect(info.mpesaName).toBe('Soeil Nissar');
    expect(info.emolaNumber).toBe('870909080');
    expect(info.emolaName).toBeNull();
  });

  it('descarta o que não é um número utilizável em vez de o mostrar', () => {
    const info = parsePaymentInfo({ mpesa_number: '123', emola_number: null });
    expect(info.mpesaNumber).toBeNull();
    expect(info.emolaNumber).toBeNull();
  });

  it('agrupa o número para se ler em voz alta', () => {
    expect(formatMobileNumber('847955382')).toBe('847 955 382');
  });

  // A razão de existir a cache: offline o balcão continua a vender e o cliente
  // continua a poder pagar por M-Pesa.
  it('sobrevive à falta de rede pela cache local', () => {
    const storage = memoryStorage();
    const info = parsePaymentInfo({ mpesa_number: '847955382', mpesa_name: 'Soeil Nissar' });
    writeCachedPaymentInfo(storage, 'maputo', info);

    expect(readCachedPaymentInfo(storage, 'maputo')).toEqual(info);
    expect(readCachedPaymentInfo(storage, 'matola')).toBeNull();
  });

  it('não rebenta com uma cache corrompida', () => {
    const storage = memoryStorage();
    storage.setItem('hs_pos_payment_info:maputo', '{isto não é json');
    expect(readCachedPaymentInfo(storage, 'maputo')).toBeNull();
  });

  it('monta o guião com o número da loja e o valor a enviar', () => {
    const info = parsePaymentInfo({ mpesa_number: '847955382', mpesa_name: 'Soeil Nissar' });
    const guiao = paymentInstructions('mpesa', info, 45_000);

    expect(guiao?.ussd).toBe('*150#');
    expect(guiao?.amount).toBe('450 MT');
    expect(guiao?.steps).toContain('Número: 847 955 382 (Soeil Nissar)');
    expect(guiao?.steps).toContain('Valor: 450 MT');
  });

  it('não inventa número quando a loja não tem nenhum configurado', () => {
    expect(paymentInstructions('emola', EMPTY_PAYMENT_INFO, 45_000)).toBeNull();
  });
});
