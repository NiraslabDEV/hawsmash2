import { z } from 'zod';

const idSchema = z.string().uuid();
const storeSlugSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const uniqueIds = z.array(idSchema).max(20).refine((ids) => new Set(ids).size === ids.length, 'Não repitas uma escolha.');
export const agentCartItemSchema = z.object({
  menuItemId: idSchema,
  qty: z.number().int().min(1).max(50),
  variantId: idSchema.optional(),
  addonIds: uniqueIds.optional(),
  modifiers: z.array(z.object({ groupId: idSchema, optionIds: uniqueIds }).strict()).max(10)
    .refine((groups) => new Set(groups.map((group) => group.groupId)).size === groups.length, 'Não repitas um grupo.').optional(),
}).strict();

/** Só escolhas públicas. Dados pessoais e pagamento são recolhidos no checkout. */
export const agentOrderSchema = z.object({
  storeSlug: storeSlugSchema,
  fulfillmentType: z.enum(['delivery', 'pickup']),
  deliveryZoneId: idSchema.optional(),
  items: z.array(agentCartItemSchema).min(1).max(20),
}).strict().superRefine((input, ctx) => {
  if (input.items.reduce((sum, item) => sum + item.qty, 0) > 100) ctx.addIssue({ code: 'custom', path: ['items'], message: 'O pedido está limitado a 100 unidades.' });
  if (input.fulfillmentType === 'delivery' && !input.deliveryZoneId) ctx.addIssue({ code: 'custom', path: ['deliveryZoneId'], message: 'Escolhe uma zona de entrega.' });
  if (input.fulfillmentType === 'pickup' && input.deliveryZoneId) ctx.addIssue({ code: 'custom', path: ['deliveryZoneId'], message: 'Levantamento não usa uma zona de entrega.' });
  if (JSON.stringify(input).length > 12000) ctx.addIssue({ code: 'custom', message: 'A selecção é demasiado extensa.' });
});
export type AgentOrderInput = z.infer<typeof agentOrderSchema>;

export const agentToolSchemas = {
  list_stores: z.object({}).strict(),
  get_menu: z.object({
    storeSlug: storeSlugSchema,
    fulfillmentType: z.enum(['delivery', 'pickup']).default('delivery'),
    query: z.string().trim().max(100).optional(),
    offset: z.number().int().min(0).max(10000).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  }).strict(),
  quote_order: agentOrderSchema,
  prepare_checkout: agentOrderSchema,
};
export type AgentToolName = keyof typeof agentToolSchemas;

export const agentToolDescriptions = {
  list_stores: { title: 'Consultar lojas', description: 'Lista as lojas deste restaurante, contactos públicos, canais, horários em Africa/Maputo e estado de abertura. Usa antes de escolher uma loja.' },
  get_menu: { title: 'Consultar cardápio', description: 'Consulta o cardápio actual da loja escolhida, com preços em centavos, disponibilidade, variantes e escolhas. Pode pesquisar e paginar produtos. Não inventes ingredientes nem garantias sobre alergénios.' },
  quote_order: { title: 'Calcular pedido', description: 'Valida produtos, quantidades, variantes, adicionais e zona na loja escolhida. Calcula uma estimativa com preços actuais do servidor. Não aplica cupões, não reserva stock, não cria encomendas nem cobra.' },
  prepare_checkout: { title: 'Preparar checkout', description: 'Valida o carrinho e devolve um link no domínio do restaurante para rever a selecção e continuar no checkout. Não cria encomenda, não reserva stock nem inicia pagamento. Nome, telefone, morada e pagamento são preenchidos no site.' },
} satisfies Record<AgentToolName, { title: string; description: string }>;

/** Metadados iguais no MCP remoto e no browser, sem importar módulos de servidor. */
export const AGENT_TOOL_DEFINITIONS = (Object.keys(agentToolSchemas) as AgentToolName[]).map((name) => ({
  name, ...agentToolDescriptions[name],
  inputSchema: z.toJSONSchema(agentToolSchemas[name], { io: 'input' }) as Record<string, unknown>,
}));
