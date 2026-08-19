'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface TableRow {
  id: string;
  number: number;
  token: string;
  active: boolean;
}

export function MesasSection() {
  const supabase = createClient();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNumber, setNewNumber] = useState('');
  const [error, setError] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    setBaseUrl(window.location.origin);
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('tables').select('id, number, token, active').order('number');
    setTables(data ?? []);
    setLoading(false);
  }

  async function addTable(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const number = parseInt(newNumber, 10);
    if (!number || number <= 0) {
      setError('Indica um número de mesa válido.');
      return;
    }
    const { error: err } = await supabase.from('tables').insert({ number });
    if (err) {
      setError(err.message.includes('duplicate') ? 'Já existe uma mesa com esse número.' : `Erro: ${err.message}`);
      return;
    }
    setNewNumber('');
    load();
  }

  async function toggleActive(t: TableRow) {
    await supabase.from('tables').update({ active: !t.active }).eq('id', t.id);
    load();
  }

  async function deleteTable(id: string) {
    if (!confirm('Apagar esta mesa? O QR code deixa de funcionar.')) return;
    await supabase.from('tables').delete().eq('id', id);
    load();
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${baseUrl}/m/${token}`);
  }

  if (loading) return <p className="text-[#C9BCAC]">A carregar…</p>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[#C9BCAC]">
        Cada mesa tem um link único (QR code) para o cardápio sem pagamento — o cliente confirma o
        pedido e ele vai direto para a impressora do balcão. Gera o QR a partir do link abaixo (ex.: em
        qr-code-generator.com) e imprime/cola na mesa.
      </p>

      <form onSubmit={addTable} className="flex gap-2 items-start">
        <input
          value={newNumber}
          onChange={(e) => setNewNumber(e.target.value)}
          type="number"
          min="1"
          placeholder="Número da mesa"
          className="bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white w-40 focus:outline-none focus:border-[#F5A623]"
        />
        <button
          type="submit"
          className="bg-[#F5A623] text-[#2A1710] font-semibold px-4 py-2 rounded-lg text-sm hover:bg-[#D6860F] transition-colors"
        >
          Adicionar mesa
        </button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="border border-white/[0.08] bg-white/[0.04] rounded-xl overflow-hidden">
        {tables.length === 0 ? (
          <p className="text-gray-400 text-center py-8">Sem mesas ainda. Adiciona a primeira acima.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {tables.map((t) => (
              <li key={t.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <span className="font-bold text-white w-20">Mesa {t.number}</span>
                <code className="text-xs text-[#C9BCAC] flex-1 min-w-0 truncate">{baseUrl}/m/{t.token}</code>
                <button
                  onClick={() => copyLink(t.token)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/[0.08] text-[#C9BCAC] hover:text-white transition-colors"
                >
                  Copiar link
                </button>
                <button
                  onClick={() => toggleActive(t)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
                    t.active ? 'bg-green-900/30 text-green-400 border border-green-700' : 'bg-white/[0.08] text-[#C9BCAC]'
                  }`}
                >
                  {t.active ? 'Ativa' : 'Inativa'}
                </button>
                <button
                  onClick={() => deleteTable(t.id)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-900/20 transition-colors"
                >
                  Apagar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
