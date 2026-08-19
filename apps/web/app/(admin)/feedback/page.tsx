'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

interface FeedbackEntry {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  order_number: string | null;
  order_status: string | null;
  total_cents: number | null;
  customer_name: string | null;
  customer_phone: string | null;
}

interface FeedbackListResponse {
  feedbacks: FeedbackEntry[];
  total: number;
}

const formatCents = (cents: number) => {
  return `MT ${(cents / 100).toLocaleString('pt-MZ', { minimumFractionDigits: 0 })}`;
};

const renderStars = (rating: number) => {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
};

export default function FeedbackPage() {
  const [feedbacks, setFeedbacks] = useState<FeedbackEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [limit] = useState(20);

  useEffect(() => {
    async function fetchFeedbacks() {
      const supabase = createClient();
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase.rpc('admin_list_feedbacks', {
        p_limit: limit,
        p_offset: page * limit,
      });

      if (err) {
        setError(err.message);
      } else {
        const response = data as FeedbackListResponse;
        setFeedbacks(response.feedbacks);
        setTotal(response.total);
      }
      setLoading(false);
    }

    fetchFeedbacks();
  }, [page, limit]);

  const totalPages = Math.ceil(total / limit);

  if (loading && page === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-10 text-center">
        <div className="text-[#F5A623]">A carregar feedbacks...</div>
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
        <h1 className="text-2xl font-bold text-white tracking-tight">Feedback</h1>
        <div className="text-[#C9BCAC] text-sm">
          Total: {total} feedback{total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Lista de feedbacks */}
      {feedbacks.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-10 text-center">
          <div className="text-[#C9BCAC]">Sem feedbacks ainda</div>
        </div>
      ) : (
        <div className="space-y-4">
          {feedbacks.map((feedback) => (
            <div
              key={feedback.id}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6 space-y-3"
            >
              {/* Header do feedback */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl text-amber-400">
                      {renderStars(feedback.rating)}
                    </span>
                    {feedback.order_number && (
                      <span className="px-2 py-1 bg-white/[0.08] rounded text-xs text-[#C9BCAC]">
                        {feedback.order_number}
                      </span>
                    )}
                  </div>
                  <div className="text-[#C9BCAC] text-sm">
                    {new Date(feedback.created_at).toLocaleDateString('pt-PT', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                {feedback.total_cents && (
                  <div className="text-right">
                    <div className="text-[#C9BCAC] text-sm">Valor do Pedido</div>
                    <div className="text-[#F5A623] font-bold">
                      {formatCents(feedback.total_cents)}
                    </div>
                  </div>
                )}
              </div>

              {/* Comentário */}
              {feedback.comment && (
                <div className="pt-3 border-t border-white/[0.04]">
                  <p className="text-[#F3E4CE]">&ldquo;{feedback.comment}&rdquo;</p>
                </div>
              )}

              {/* Informações do cliente */}
              {(feedback.customer_name || feedback.customer_phone) && (
                <div className="pt-3 border-t border-white/[0.04] text-sm">
                  <div className="text-[#C9BCAC]">
                    Cliente: {feedback.customer_name || 'N/A'}
                    {feedback.customer_phone && ` • ${feedback.customer_phone}`}
                  </div>
                </div>
              )}
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