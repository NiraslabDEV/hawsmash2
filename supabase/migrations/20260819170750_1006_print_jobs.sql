-- HAWSMASH 2.0 — F3 / 1006: fila idempotente de impressão por loja.

alter table public.print_jobs
  alter column order_id drop not null;

alter table public.print_jobs
  add column if not exists kind text not null default 'order',
  add column if not exists reprint_seq integer not null default 0;

-- O motor antigo admitia cold_kitchen; o HAWSMASH tem uma única cozinha por
-- loja e encaminha essas comandas para a estação kitchen.
update public.print_jobs
set station = 'kitchen'
where station = 'cold_kitchen';

alter table public.print_jobs
  drop constraint if exists print_jobs_station_check,
  drop constraint if exists print_jobs_kind_check,
  drop constraint if exists print_jobs_reprint_seq_check;

alter table public.print_jobs
  add constraint print_jobs_station_check
    check (station in ('kitchen', 'counter', 'bar')),
  add constraint print_jobs_kind_check
    check (kind in ('order', 'receipt', 'drawer', 'cash_close', 'test')),
  add constraint print_jobs_reprint_seq_check
    check (reprint_seq >= 0);

create unique index if not exists print_jobs_order_station_kind_reprint_uidx
  on public.print_jobs (order_id, station, kind, reprint_seq);

create index if not exists print_jobs_store_queue_idx
  on public.print_jobs (store_id, status, created_at)
  where status in ('queued', 'printing', 'failed');
