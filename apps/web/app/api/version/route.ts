// A versão deste deploy. O POS (quiosque, nunca recarregado à mão) compara-a
// com a sua e recarrega-se quando pode — ver lib/pos/app-update.ts.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json(
    { build: process.env.NEXT_PUBLIC_APP_BUILD ?? null },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
