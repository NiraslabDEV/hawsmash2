-- Modelos dos emissores existentes, sem alterar dados de vendas ou o seu relógio.
create table if not exists public.email_system_templates (
  store_id uuid not null references public.stores(id),
  key text not null check(key in ('paid','cancelled','proof','account_code','cash_close','cash_day','digest','monthly','alerts')),
  mode text not null default 'current' check(mode in ('current','custom')),
  enabled boolean not null default true,
  template_id text not null default 'current',
  step jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(store_id,key),
  check(key<>'account_code' or enabled)
);
create table if not exists public.email_campaign_knowledge (
  store_id uuid primary key references public.stores(id),
  notes text not null default '' check(length(notes)<=12000),
  updated_at timestamptz not null default now()
);
create table if not exists public.email_delivery_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  event text not null,
  recipient text not null,
  status text not null check(status in ('sent','failed','disabled')),
  created_at timestamptz not null default now()
);
create index if not exists email_delivery_store on public.email_delivery_log(store_id,created_at desc,id);
do $$ declare t text; begin
  foreach t in array array['email_system_templates','email_campaign_knowledge','email_delivery_log'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('drop policy if exists email_owner_read on public.%I',t);
    execute format('create policy email_owner_read on public.%I for select to authenticated using ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)))',t);
  end loop;
end $$;

-- Registar os nove emails que o código já emite, conservando o modelo original.
insert into public.email_system_templates(store_id,key,step)
select s.id,k.key,'{"subject":"{{assunto_original}}","preheader":"","delay_minutes":0,"theme":"classic","blocks":[{"type":"system"}]}'::jsonb
from public.stores s cross join (values('paid'),('cancelled'),('proof'),('cash_close'),('cash_day'),('account_code'),('digest'),('monthly'),('alerts')) k(key)
where k.key in ('paid','cancelled','proof','cash_close','cash_day') or s.id=(select id from public.stores order by sort,id limit 1)
on conflict do nothing;

create or replace function private.email_validate_steps(p_steps jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare s jsonb; b jsonb;
begin
  if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) not between 1 and 12 then return false; end if;
  for s in select value from jsonb_array_elements(p_steps) loop
    if coalesce(length(trim(s->>'subject')),0) not between 1 and 200 or s->>'subject' ~ E'[\r\n]'
      or coalesce(s->>'delay_minutes','') !~ '^[0-9]{1,6}$' or (s->>'delay_minutes')::integer>525600
      or jsonb_typeof(s->'blocks') is distinct from 'array' or coalesce(s->>'theme','classic') not in ('classic','gold','dark','editorial') then return false; end if;
    if jsonb_array_length(s->'blocks') not between 1 and 40 then return false; end if;
    for b in select value from jsonb_array_elements(s->'blocks') loop
      if coalesce(b->>'type','') not in ('heading','text','image','button','divider') then return false; end if;
      if b->>'type'<>'divider' and (jsonb_typeof(b->'text') is distinct from 'string' or length(b->>'text')>10000) then return false; end if;
      if b->>'type' in ('image','button') and
        not(b->>'type'='button' and b->>'url' in ('{{menu_url}}','{{review_url}}')) and
        (coalesce(b->>'url','') !~ '^https://[^[:space:]]+$' or length(b->>'url')>2048) then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function public.email_save_system(p_store_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_store uuid:=p_store_id; v_step jsonb:=p_data->'step'; v_blocks jsonb;
begin
  perform private.assert_staff_admin();
  if not private.auth_can_store(p_store_id) then raise exception 'store_denied'; end if;
  if p_data->>'key' in ('account_code','digest','monthly','alerts') then select id into v_store from public.stores order by sort,id limit 1; end if;
  if jsonb_typeof(v_step->'blocks') is distinct from 'array' or v_step->>'delay_minutes'<>'0'
    or (select count(*) from jsonb_array_elements(v_step->'blocks') b where b->>'type'='system')<>1
    or (p_data->>'key'='account_code' and p_data->>'enabled'<>'true') then raise exception 'invalid_system_template'; end if;
  select coalesce(jsonb_agg(b),'[{"type":"text","text":""}]'::jsonb) into v_blocks
    from jsonb_array_elements(v_step->'blocks') b where b->>'type'<>'system';
  if not private.email_validate_steps(jsonb_build_array(v_step||jsonb_build_object('blocks',v_blocks))) then raise exception 'invalid_system_template'; end if;
  insert into public.email_system_templates(store_id,key,mode,enabled,template_id,step)
  values(v_store,p_data->>'key',p_data->>'mode',(p_data->>'enabled')::boolean,p_data->>'template_id',v_step)
  on conflict(store_id,key) do update set mode=excluded.mode,enabled=excluded.enabled,template_id=excluded.template_id,step=excluded.step,updated_at=now();
  insert into public.event_log(store_id,actor_user_id,type,payload) values(v_store,auth.uid(),'email.system_template',jsonb_build_object('key',p_data->>'key','mode',p_data->>'mode'));
end $$;
revoke all on function public.email_save_system(uuid,jsonb) from public,anon;
grant execute on function public.email_save_system(uuid,jsonb) to authenticated;

create or replace function public.email_save_knowledge(p_store_id uuid,p_notes text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_staff_admin();
  if not private.auth_can_store(p_store_id) then raise exception 'store_denied'; end if;
  insert into public.email_campaign_knowledge(store_id,notes) values(p_store_id,p_notes)
    on conflict(store_id) do update set notes=excluded.notes,updated_at=now();
  insert into public.event_log(store_id,actor_user_id,type,payload) values(p_store_id,auth.uid(),'email.knowledge_saved','{}');
end $$;
revoke all on function public.email_save_knowledge(uuid,text) from public,anon;
grant execute on function public.email_save_knowledge(uuid,text) to authenticated;
