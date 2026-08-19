import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createReceipt, decodeReceipt } from '../escpos';
import type { PrintJobPayload } from '../types';

describe('Print Bridge Integration — DoD F2.2', () => {
  describe('1. Cupom de delivery com todos os campos', () => {
    it('imprime cupom completo com nome do cliente em destaque', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        delivery_zone: 'Polana Cimento A',
        address: 'Av. Julius Nyerere, 456, apto 12',
        scheduled_for: new Date('2026-06-14T20:30:00Z').toISOString(),
        items: [
          { name: 'Frango Grelhado', quantity: 2, notes: 'sem cebola' },
          { name: 'Batata Frita', quantity: 1 },
        ],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        notes: 'Cliente pediu talheres extra',
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      
      // Verifica nome em destaque (deve estar em uppercase)
      expect(text).toContain('MARIA SANTOS');
      
      // Verifica número do pedido
      expect(text).toContain('ENC-0042');
    });

    it('mostra itens e notas corretamente', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [
          { name: 'Frango Grelhado', quantity: 2, notes: 'sem cebola' },
          { name: 'Batata Frita', quantity: 1 },
        ],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      
      expect(text).toContain('2x Frango Grelhado (sem cebola)');
      expect(text).toContain('1x Batata Frita');
    });

    it('mostra ENTREGA com zona e morada', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        delivery_zone: 'Polana Cimento A',
        address: 'Av. Julius Nyerere, 456, apto 12',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      
      expect(text).toContain('ENTREGA');
      expect(text).toContain('Zona: Polana Cimento A');
      expect(text).toContain('Morada: Av. Julius Nyerere, 456, apto 12');
    });

    it('mostra LEVANTAMENTO sem zona/morada', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'pickup',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      
      expect(text).toContain('LEVANTAMENTO');
      expect(text).not.toContain('Zona:');
      expect(text).not.toContain('Morada:');
    });

    it('mostra horário AGORA para scheduled_for null', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        scheduled_for: null, // AGORA
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('AGORA (ASAP)');
    });

    it('mostra horário formatado HH:MM para scheduled_for definido', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        scheduled_for: new Date('2026-06-14T20:30:00Z').toISOString(),
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toMatch(/Horario: \d{2}:\d{2}/);
    });

    it('mostra estado de pagamento PAGO VIA M-PESA', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('[ PAGO VIA M-PESA ]');
    });

    it('mostra AGUARDA PAGAMENTO para payment_status=pending', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'pickup',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'cash',
        payment_status: 'pending',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('[ PAGAR NA ENTREGA/LEVANTAMENTO ]');
    });

    it('mostra total formatado em MT', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('650.00 MT');
    });

    it('inclui hora do pedido', () => {
      const now = new Date();
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: now.toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('Hora:');
    });

    it('inclui notas do pedido se existirem', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        notes: 'Cliente pediu talheres extra e molho extra',
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('--- NOTAS ---');
      expect(text).toContain('Cliente pediu talheres extra e molho extra');
    });
  });

  describe('2. Formatação de métodos de pagamento', () => {
    it('formata M-Pesa', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'mpesa',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('M-PESA');
    });

    it('formata e-Mola', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'emola',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('E-MOLA');
    });

    it('formata Dinheiro', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'pickup',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'cash',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('DINHEIRO');
    });

    it('formata Cartão', () => {
      const job: PrintJobPayload = {
        order_number: 'ENC-0042',
        customer_name: 'Maria Santos',
        fulfillment_type: 'delivery',
        items: [{ name: 'Frango Grelhado', quantity: 2 }],
        payment_method: 'credit_card',
        payment_status: 'paid',
        total_cents: 65000,
        created_at: new Date().toISOString(),
      };

      const text = decodeReceipt(createReceipt(job));
      expect(text).toContain('CARTAO');
    });
  });
});