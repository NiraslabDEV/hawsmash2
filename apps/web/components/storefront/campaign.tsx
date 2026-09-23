'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import styles from './campaign.module.css';

export interface StoreCampaign {
  id: string;
  discount_bps: number;
  starts_at: string;
  ends_at: string;
  title: string;
  banner_url: string;
}

/** A expiração vem do servidor; não reinicia ao abrir a página. */
export function CampaignBanner({ campaign, onEnd }: { campaign?: StoreCampaign | null; onEnd?: () => void }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!campaign) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [campaign]);
  const end = campaign ? Date.parse(campaign.ends_at) : NaN;
  const expired = now !== null && now >= end;
  useEffect(() => {
    if (expired) onEnd?.();
  }, [expired, onEnd]);
  if (!campaign || !Number.isFinite(end) || expired) return null;
  const start = Date.parse(campaign.starts_at);
  const progress = now === null ? 0 : Math.min(100, Math.max(0, (now - start) * 100 / (end - start)));
  const date = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Africa/Maputo', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(end - 1);
  return (
    <aside className={styles.banner} aria-label={campaign.title}>
      <a href="#cardapio" aria-label={`${campaign.title}. Ver cardápio`}>
        <Image src={campaign.banner_url} alt={campaign.title} width={1672} height={941} sizes="(min-width: 1200px) 1200px, 100vw" />
      </a>
      <div className={styles.details}>
        <strong>{campaign.discount_bps / 100}% de desconto em todo o cardápio</strong>
        <span>Até {date}, hora de Maputo.</span>
        <p>Desconto automático sobre a nova tabela de preços. Entrega não incluída. Não acumula com cupões.</p>
        <label className={styles.deadline}>Prazo da campanha <progress max={100} value={progress} /></label>
        <a className={styles.cta} href="#cardapio">Escolher o meu pedido →</a>
      </div>
    </aside>
  );
}

/** Ambos os preços vêm da RPC. A UI não inventa referências nem descontos. */
export function CampaignPrice({ priceCents, listPriceCents, discountBps }: { priceCents: number; listPriceCents?: number; discountBps?: number }) {
  const discounted = Number.isInteger(listPriceCents) && (listPriceCents ?? 0) > priceCents;
  return (
    <div className={styles.prices}>
      {discounted ? <span className={styles.list}>Tabela <s>{formatMT(listPriceCents as Cents)}</s></span> : null}
      <span className={styles.current}>{discounted ? <small>Na campanha</small> : null}<strong>{formatMT(priceCents as Cents)}</strong></span>
      {discounted ? <span className={styles.saving}>
        {discountBps ? <b className={styles.badge}>−{discountBps / 100}%</b> : null}
        Poupa {formatMT(((listPriceCents ?? 0) - priceCents) as Cents)}
      </span> : null}
    </div>
  );
}
