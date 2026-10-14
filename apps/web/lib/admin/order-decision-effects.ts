import { staffFetch } from '@/lib/admin/staff-fetch';

/**
 * O que se segue a aprovar ou recusar um pedido da internet — email ao
 * cliente e conversão do pixel. Num só sítio, porque há três portas que
 * decidem (painel /pedidos, botões do POS e seta do quadro) e o POS aprovava
 * sem mandar o "pagamento confirmado" ao cliente.
 *
 * Chamar só depois de `advance_order` ter sucesso. Best-effort (CLAUDE §1):
 * não espera nem lança. As rotas lêem destinatário e estado da BD — um pedido
 * sem email responde 409 e não acontece nada.
 */
export function afterOrderDecision(orderId: string, event: string, reason?: string): void {
  const post = (url: string, body: unknown) =>
    staffFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});

  if (event === 'APPROVE') {
    void post('/api/conversions/fire', { orderId });
    void post('/api/emails/send-approval-email', { orderId });
  }
  if (event === 'CANCEL') {
    void post('/api/emails/send-rejection-email', { orderId, reason });
  }
}
