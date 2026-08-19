export type SystemAlert = {
  store_id: string;
  store_name: string;
  kind: 'device_silent' | 'print_failed' | 'order_not_printed' | 'stock' | 'no_sales';
  severity: 'critical' | 'warning';
  message: string;
  details?: Record<string, unknown>;
};

export type AlertRecipientStore = {
  store_id: string;
  store_name: string;
  phone: string | null;
};

export const ALERT_LABELS: Record<SystemAlert['kind'], string> = {
  device_silent: 'Dispositivo sem sinal',
  print_failed: 'Impressão falhada',
  order_not_printed: 'Pedido pago sem comanda',
  stock: 'Estoque em rotura',
  no_sales: 'Sem vendas em horário de loja',
};

/** Janela mínima entre dois avisos do mesmo tipo na mesma loja. */
export const ALERT_COOLDOWN_MINUTES = 30;

export type SentAlert = { store_id: string; kind: string; sent_at: string };

/**
 * Um alerta repetido não vira spam: só sai de novo depois do arrefecimento.
 * É o que permite correr o cron de 5 em 5 minutos sem incomodar o dono.
 */
export function pendingAlerts(
  alerts: SystemAlert[],
  alreadySent: SentAlert[],
  now: Date = new Date(),
): SystemAlert[] {
  const cutoff = now.getTime() - ALERT_COOLDOWN_MINUTES * 60_000;
  const recent = new Set(
    alreadySent
      .filter((entry) => new Date(entry.sent_at).getTime() >= cutoff)
      .map((entry) => `${entry.store_id}|${entry.kind}`),
  );
  return alerts.filter((alert) => !recent.has(`${alert.store_id}|${alert.kind}`));
}

/** Link para abrir o WhatsApp já com a mensagem escrita para a loja. */
export function whatsappLink(phone: string | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return null;
  const international = digits.startsWith('258') ? digits : `258${digits}`;
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function alertSubject(alerts: SystemAlert[]): string {
  const critical = alerts.filter((alert) => alert.severity === 'critical').length;
  const stores = Array.from(new Set(alerts.map((alert) => alert.store_name))).join(' e ');
  return critical > 0
    ? `HAWSMASH · ${critical} alerta(s) crítico(s) em ${stores}`
    : `HAWSMASH · ${alerts.length} aviso(s) em ${stores}`;
}

/** Email curto: o que falhou, em que loja, e um botão para falar com a loja. */
export function alertEmailHtml(alerts: SystemAlert[], stores: AlertRecipientStore[]): string {
  const byStore = new Map<string, SystemAlert[]>();
  for (const alert of alerts) {
    byStore.set(alert.store_id, [...(byStore.get(alert.store_id) ?? []), alert]);
  }

  const blocks = Array.from(byStore.entries()).map(([storeId, storeAlerts]) => {
    const store = stores.find((entry) => entry.store_id === storeId);
    const name = escapeHtml(store?.store_name ?? storeAlerts[0].store_name);
    const items = storeAlerts
      .map(
        (alert) =>
          `<li><strong>${escapeHtml(ALERT_LABELS[alert.kind])}</strong>: ${escapeHtml(alert.message)}</li>`,
      )
      .join('');
    const link = whatsappLink(
      store?.phone ?? null,
      `HAWSMASH ${store?.store_name ?? name}: ${storeAlerts[0].message}`,
    );
    const button = link
      ? `<p><a href="${link}" style="display:inline-block;background:#e5a93c;color:#0a0807;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Falar com a loja no WhatsApp</a></p>`
      : '';
    return `<h2 style="color:#e5a93c;font-size:16px;margin:24px 0 8px">${name}</h2><ul>${items}</ul>${button}`;
  });

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h1 style="color:#e5a93c;font-size:20px">Alerta do sistema HAWSMASH</h1>
      <p>O sistema detectou o seguinte e avisou sozinho:</p>
      ${blocks.join('')}
      <p style="color:#847e72;font-size:12px">Este email é automático. O painel Sistema mostra o estado ao vivo.</p>
    </div>`;
}
