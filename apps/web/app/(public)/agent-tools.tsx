'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AGENT_TOOL_DEFINITIONS, agentOrderSchema } from '@/lib/agents/schemas';
import {
  callPublicAgentTool,
  isAgentOrderingPath,
  readAgentCart,
  registerBrowserTools,
  safeAgentReviewUrl,
  type BrowserTool,
  type ModelContextDocument,
} from '@/lib/agents/webmcp';

/** Ferramentas só no funil público. Sessão/conta/POS nunca fazem parte deste contrato. */
export function AgentTools() {
  const pathname = usePathname();

  useEffect(() => {
    if (!isAgentOrderingPath(pathname)) return;
    const lifetime = new AbortController();
    const assertActive = () => {
      if (lifetime.signal.aborted || !isAgentOrderingPath(window.location.pathname)) throw new Error('Abre o cardápio para usar esta ferramenta.');
    };
    const request = async (name: string, args: unknown, signal?: AbortSignal) => {
      assertActive();
      const result = await callPublicAgentTool(name, args, signal ?? lifetime.signal);
      assertActive();
      return result;
    };
    const tools = AGENT_TOOL_DEFINITIONS.map<BrowserTool>((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (args, context) => request(tool.name, args, context?.signal),
    }));

    const reviewSelection = async (args: Record<string, unknown>, context?: { signal?: AbortSignal }) => {
      const input = agentOrderSchema.parse(args);
      const result = await request('prepare_checkout', input, context?.signal);
      const url = safeAgentReviewUrl(result.checkoutUrl, window.location.origin);
      // DECISÃO: o useCart tem estado por componente. Alterar o storage enquanto
      // a montra está montada criaria dois carrinhos. A revisão é uma navegação
      // completa e o seu botão humano faz a única substituição efectiva.
      window.location.assign(url);
      return { reviewUrl: url, confirmationRequired: true, notice: 'Revê os artigos e confirma no site para substituir o carrinho. Nenhum pedido foi enviado.' };
    };
    tools.push({
      name: 'get_cart',
      description: 'Lê os artigos e a loja do carrinho deste browser, sem notas pessoais. Não calcula preços.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => { assertActive(); return readAgentCart(window.localStorage); },
    });
    const orderSchema = AGENT_TOOL_DEFINITIONS.find((tool) => tool.name === 'prepare_checkout')!.inputSchema;
    tools.push({
      name: 'replace_cart',
      description: 'Prepara uma substituição exacta do carrinho por ids e quantidades, valida preços no servidor e abre a revisão. Só o botão de confirmação no site substitui o carrinho; repetir não acumula artigos. Não envia pedidos nem cobra.',
      inputSchema: orderSchema,
      annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: true },
      execute: reviewSelection,
    }, {
      name: 'open_checkout',
      description: 'Abre a revisão de uma selecção completa (loja, artigos, entrega/levantamento e zona), para o cliente confirmar e continuar para o checkout. Não cria pedidos nem pagamentos.',
      inputSchema: orderSchema,
      annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: true },
      execute: reviewSelection,
    });
    const unregister = registerBrowserTools(document as Document & ModelContextDocument, tools);
    return () => { lifetime.abort(); unregister(); };
  }, [pathname]);

  return null;
}
