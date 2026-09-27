export default function Unsubscribe({
  searchParams,
}: {
  searchParams: { t?: string };
}) {
  return (
    <main className="min-h-screen bg-[#171411] p-8 text-white grid place-items-center">
      <section className="max-w-md space-y-6">
        <h1 className="text-3xl font-bold">Cancelar subscrição</h1>
        <p>
          Deixarás de receber promoções desta loja. Os emails relativos aos teus
          pedidos continuam disponíveis.
        </p>
        <form action="/api/email-studio/unsubscribe" method="post">
          <input type="hidden" name="token" value={searchParams.t ?? ''} />
          <button className="rounded-xl bg-[#e5a93c] px-6 py-3 font-bold text-black">
            Cancelar as promoções
          </button>
        </form>
      </section>
    </main>
  );
}
