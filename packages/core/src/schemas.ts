import { z } from 'zod';

export const createOrderInputSchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        qty: z.number().int().positive(),
        // F8: tamanho (escolha única) e adicionais (multi). Preço recalculado no servidor.
        variantId: z.string().uuid().optional(),
        addonIds: z.array(z.string().uuid()).optional(),
        notes: z.string().max(200).optional(),
      }),
    )
    .min(1, 'Pedido deve ter pelo menos 1 item'),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().max(20).optional(),
  fulfillmentType: z.enum(['pickup', 'delivery']),
  deliveryZoneId: z.string().uuid().optional(),
  address: z.string().max(300).optional(),
  // null = ASAP; string ISO = horário agendado do próprio dia
  scheduledFor: z.string().datetime().nullable().optional(),
  paymentMethod: z.enum(['mpesa', 'emola', 'credit_card', 'cash']),
  notes: z.string().max(400).optional(),
  // F5.1: código de indicação/cupom (validado e revalidado no servidor)
  referralCode: z.string().max(50).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

export const paysuiteWebhookSchema = z.object({
  event: z.enum(['payment.success', 'payment.failed']),
  request_id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor decimal inválido'),
  method: z.enum(['mpesa', 'emola', 'credit_card']),
  provider_ref: z.string().optional(),
});

export type PaysuiteWebhook = z.infer<typeof paysuiteWebhookSchema>;
