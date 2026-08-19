'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

interface WaitlistEntry {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  created_at: string;
}

interface WaitlistListResponse {
  entries: WaitlistEntry[];
  total: number;
}

const formatPhone = (phone: string) => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5)}`;
  }
  return phone;
};

export default function ListaEsperaPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [limit] = useState(20);

  useEffect(() => {
    async function fetchWaitlist() {
      const supabase = createClient();
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase.rpc('admin_list_waitlist', {
        p_limit: limit,
        p_offset: page * limit,
      });

      if (err) {
        setError(err.message);
      } else {
        const response = data as WaitlistListResponse;
        setEntries(response.entries);
        setTotal(response.total);
      }
      setLoading(false);
    }

    fetchWaitlist();
  }, [page, limit]);

  const totalPages = Math.ceil(total / limit);

  if (loading && page === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-10 text-center">
        <div className="text-[#F5A623]">A carregar lista de espera...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-10 text-center">
        <div className="text-red-400">Erro: {error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white tracking-tight">Lista de Espera</h1>
        <div className="text-[#C9BCAC] text-sm">
          Total: {total} {total !== 1 ? 'pessoas' : 'pessoa'}
        </div>
      </div>

      {/* Lista de espera */}
      {entries.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-10 text-center">
          <div className="text-[#C9BCAC]">Lista de espera vazia</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6 space-y-3"
            >
              {/* Nome */}
              <div>
                <div className="text-[#C9BCAC] text-sm mb-1">Nome</div>
                <div className="text-[#F3E4CE] font-semibold">{entry.name}</div>
              </div>

              {/* Telefone */}
              <div>
                <div className="text-[#C9BCAC] text-sm mb-1">Telefone</div>
                <div className="text-[#F5A623]">{formatPhone(entry.phone)}</div>
              </div>

              {/* Notas */}
              {entry.notes && (
                <div className="pt-3 border-t border-white/[0.04]">
                  <div className="text-[#C9BCAC] text-sm mb-1">Notas</div>
                  <p className="text-[#F3E4CE] text-sm">{entry.notes}</p>
                </div>
              )}

              {/* Data de registro */}
              <div className="pt-3 border-t border-white/[0.04] text-sm">
                <div className="text-[#C9BCAC]">
                  Registado em{' '}
                  {new Date(entry.created_at).toLocaleDateString('pt-PT', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 bg-white/[0.08] rounded text-[#F3E4CE] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/[0.12] transition-colors"
          >
            Anterior
          </button>
          <span className="text-[#C9BCAC]">
            Página {page + 1} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="px-4 py-2 bg-white/[0.08] rounded text-[#F3E4CE] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/[0.12] transition-colors"
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}