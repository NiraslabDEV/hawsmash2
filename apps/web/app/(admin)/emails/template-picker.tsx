'use client';
import { useState } from 'react';
import { EMAIL_TEMPLATES } from '@/lib/email/template-library';
import { buttonClass } from './shared';
export function TemplatePicker({
  onSelect,
}: {
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <button className={buttonClass} onClick={() => setOpen(!open)}>
        {open ? 'Fechar biblioteca' : 'Escolher modelo · 12 disponíveis'}
      </button>
      {open && (
        <div className="grid gap-3 sm:grid-cols-2">
          {EMAIL_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onSelect(t.id);
                setOpen(false);
              }}
              className="rounded-xl border border-white/15 p-3 text-left hover:border-[#e5a93c] focus-visible:outline focus-visible:outline-[#e5a93c]"
            >
              <div
                aria-hidden
                className={`mb-3 rounded-lg p-3 ${t.step.theme === 'dark' ? 'bg-[#171411]' : t.step.theme === 'gold' ? 'bg-[#f7eddc]' : 'bg-[#f5f4f1]'}`}
              >
                <div className="mx-auto rounded bg-white p-3 border-t-4 border-[#e5a93c]">
                  <div className="h-2 w-2/3 bg-[#554b40] mb-2" />
                  <div className="h-1 bg-[#ddd] mb-1" />
                  <div className="h-1 w-4/5 bg-[#ddd]" />
                  <div className="h-3 w-12 rounded bg-[#e5a93c] mt-3" />
                </div>
              </div>
              <span className="text-xs text-[#e5a93c]">{t.category}</span>
              <strong className="block mt-1 text-sm">{t.name}</strong>
              <span className="block mt-1 text-xs text-[#b4aa9c] line-clamp-2">
                {t.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
