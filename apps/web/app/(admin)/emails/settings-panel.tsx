'use client';
import { useState } from 'react';
import { buttonClass, fieldClass, primaryClass, type Settings } from './shared';
export function SettingsPanel({
  value,
  onSave,
  onVerify,
  busy,
  ownerEmail,
  centralOwnerEmail,
  onOwnerSave,
}: {
  value: Settings | null;
  onSave: (value: Settings & { password: string }) => Promise<unknown>;
  onVerify: () => Promise<unknown>;
  busy: boolean;
  ownerEmail: string;
  centralOwnerEmail: string;
  onOwnerSave: (email: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Settings>(
    value ?? {
      enabled: false,
      host: 'smtp.hostinger.com',
      port: 465,
      username: '',
      from_name: '',
      from_email: '',
      reply_to: '',
    },
  );
  const [password, setPassword] = useState('');
  const [recipient, setRecipient] = useState(ownerEmail);
  return (
    <div className="max-w-3xl space-y-8">
      <form
        className="max-w-3xl space-y-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onSave({ ...draft, password })) setPassword('');
        }}
      >
        <div>
          <h2 className="text-xl font-bold">Remetente e servidor de envio</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#b4aa9c]">
            Configuração desta loja. A palavra-passe é guardada de forma cifrada
            e nunca é devolvida ao painel.
          </p>
        </div>
        <section className="rounded-2xl border border-white/10 bg-[#1c1915] p-5 space-y-5">
          <label className="flex items-center justify-between gap-4">
            <span>
              <strong className="block text-sm">Activar envio de emails</strong>
              <span className="text-xs text-[#b4aa9c]">
                Desligar mantém a fila em espera.
              </span>
            </span>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
              className="h-6 w-6 accent-[#e5a93c]"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                { key: 'from_name', label: 'Nome do remetente', type: 'text' },
                {
                  key: 'from_email',
                  label: 'Email do remetente',
                  type: 'email',
                },
                {
                  key: 'reply_to',
                  label: 'Responder para (opcional)',
                  type: 'email',
                },
                { key: 'host', label: 'Servidor SMTP', type: 'text' },
                { key: 'username', label: 'Utilizador SMTP', type: 'text' },
              ] as const
            ).map((f) => (
              <label key={f.key} className="space-y-2 text-sm">
                <span>{f.label}</span>
                <input
                  type={f.type}
                  required={f.key !== 'reply_to'}
                  value={draft[f.key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [f.key]: e.target.value })
                  }
                  className={fieldClass}
                />
              </label>
            ))}
            <label className="space-y-2 text-sm">
              <span>Porta e segurança</span>
              <select
                className={fieldClass}
                value={draft.port}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    port: Number(e.target.value) as 465 | 587,
                  })
                }
              >
                <option value={465}>465 — TLS</option>
                <option value={587}>587 — STARTTLS obrigatório</option>
              </select>
            </label>
            <label className="space-y-2 text-sm sm:col-span-2">
              <span>
                Palavra-passe SMTP{' '}
                {value?.password_configured && '· já configurada'}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
                placeholder={
                  value?.password_configured
                    ? 'Deixa vazio para manter a palavra-passe'
                    : 'Palavra-passe da caixa de email'
                }
              />
            </label>
          </div>
        </section>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} className={primaryClass} type="submit">
            {busy ? 'A guardar…' : 'Guardar configuração'}
          </button>
          <button
            disabled={busy || !value?.password_configured}
            type="button"
            className={buttonClass}
            onClick={() => void onVerify()}
          >
            Testar ligação guardada
          </button>
        </div>
        <p className="text-xs leading-relaxed text-[#b4aa9c]">
          O teste verifica a ligação e as credenciais, sem enviar mensagens. O
          fornecedor deve autorizar o domínio do remetente. A fila é processada
          de minuto a minuto quando o agendador está instalado. Os emails gerais
          e relatórios usam a primeira loja com SMTP activo, pela ordem das
          lojas. As credenciais antigas do ambiente continuam como alternativa
          enquanto existirem.
        </p>
      </form>
      <form
        className="rounded-2xl border border-white/10 bg-[#1c1915] p-5 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await onOwnerSave(recipient);
        }}
      >
        <h2 className="text-xl font-bold">Relatórios ao dono</h2>
        <p className="text-sm text-[#b4aa9c]">
          Resumo diário às 08h e resumo mensal no dia 1 às 08h, hora de Maputo.
          O resumo agrega as lojas e é enviado aos destinatários configurados.
        </p>
        <label className="block space-y-2 text-sm">
          <span>Destinatário adicional desta loja</span>
          <input
            className={fieldClass}
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        {centralOwnerEmail && (
          <p className="text-xs text-[#b4aa9c]">
            Destinatário central do ambiente: {centralOwnerEmail}. A alteração
            deste destinatário central é feita no Railway.
          </p>
        )}
        <button disabled={busy} className={buttonClass}>
          Guardar destinatário
        </button>
      </form>
    </div>
  );
}
