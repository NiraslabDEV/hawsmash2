'use client';
import { useState } from 'react';
import { buttonClass, fieldClass, primaryClass, type Contact } from './shared';
export function ContactsPanel({
  contacts,
  total,
  busy,
  onSave,
  onCancel,
}: {
  contacts: Contact[];
  total: number;
  busy: boolean;
  onSave: (v: {
    name: string;
    email: string;
    consent_source: string;
  }) => Promise<unknown>;
  onCancel: (id: string) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Contactos de marketing</h2>
        <p className="mt-2 text-sm text-[#b4aa9c]">
          {total} contactos registados. Comprar na loja não inscreve
          automaticamente em promoções.
        </p>
      </div>
      <form
        className="grid gap-4 rounded-2xl border border-white/10 bg-[#1c1915] p-5 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await onSave({ name, email, consent_source: source });
          if (result) {
            setName('');
            setEmail('');
            setSource('');
          }
        }}
      >
        <label className="space-y-2 text-sm">
          <span>Nome</span>
          <input
            maxLength={120}
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm">
          <span>Email</span>
          <input
            required
            type="email"
            className={fieldClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm md:col-span-2">
          <span>Onde e quando aceitou receber promoções?</span>
          <input
            required
            minLength={3}
            maxLength={500}
            className={fieldClass}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Indica a origem e a data do consentimento"
          />
        </label>
        <label className="flex gap-3 items-center text-sm md:col-span-2">
          <input
            required
            type="checkbox"
            className="h-5 w-5 accent-[#e5a93c]"
            key={email + source}
          />
          Confirmo que este contacto autorizou os emails de marketing.
        </label>
        <button disabled={busy} className={primaryClass}>
          Adicionar contacto
        </button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-[#b4aa9c]">
            <tr>
              <th className="p-4">Contacto</th>
              <th className="p-4">Consentimento</th>
              <th className="p-4">Estado</th>
              <th className="p-4">
                <span className="sr-only">Acções</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id} className="border-t border-white/10">
                <td className="p-4">
                  <strong className="block">{c.name || 'Sem nome'}</strong>
                  <span className="text-[#b4aa9c]">{c.email}</span>
                </td>
                <td className="p-4 text-[#b4aa9c]">{c.consent_source}</td>
                <td className="p-4">
                  {c.unsubscribed_at ? 'Cancelado' : 'Subscrito'}
                </td>
                <td className="p-4">
                  {!c.unsubscribed_at && (
                    <button
                      disabled={busy}
                      className={buttonClass}
                      onClick={() => void onCancel(c.id)}
                    >
                      Cancelar subscrição
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={4} className="p-10 text-center text-[#b4aa9c]">
                  Adiciona o primeiro contacto com consentimento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
