import { z } from 'zod';
import { serviceClient } from '@/lib/payments/direct';
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = z.string().uuid().safeParse(form?.get('token'));
  if (!token.success) return new Response('Link inválido.', { status: 400 });
  const { error } = await serviceClient().rpc('email_unsubscribe', {
    p_token: token.data,
  });
  return new Response(
    error
      ? 'Não foi possível cancelar. Tenta novamente.'
      : 'Subscrição cancelada. Não receberás mais promoções desta loja.',
    {
      status: error ? 503 : 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}
