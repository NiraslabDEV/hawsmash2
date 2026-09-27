-- Emails por loja: editor, sequências, consentimento e outbox. Nenhum envio no trigger.
create table if not exists public.email_settings (
  store_id uuid primary key references public.stores(id),
  enabled boolean not null default false,
  host text not null default 'smtp.hostinger.com',
  port integer not null default 465 check(port in (465,587)),
  username text not null default '',
  from_name text not null default '',
  from_email text not null default '',
  reply_to text not null default '',
  password_configured boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists private.email_passwords (
  store_id uuid primary key references public.stores(id), secret_id uuid not null
);
revoke all on private.email_passwords from public,anon,authenticated;

create table if not exists public.email_flows (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  name text not null check(length(name) between 1 and 120),
  kind text not null check(kind in ('transactional','marketing')),
  trigger text not null,
  status text not null default 'draft' check(status in ('draft','active','paused','archived')),
  steps jsonb not null check(jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 12),
  updated_at timestamptz not null default now(),
  check((kind='transactional' and trigger in ('paid','cancelled','ready','delivered')) or
        (kind='marketing' and trigger in ('manual','subscribed'))),
  unique(id,store_id)
);
-- Uma única sequência transaccional por evento para não duplicar mensagens.
create unique index if not exists email_one_transaction on public.email_flows(store_id,trigger)
  where kind='transactional' and status <> 'archived';
create table if not exists public.email_contacts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  email text not null check(email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  name text not null default '',
  consent_source text not null check(length(trim(consent_source)) between 3 and 500),
  consent_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  unique(store_id,email)
);
create table if not exists public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  flow_id uuid not null,
  event_key text not null,
  recipient text not null,
  step_index integer not null,
  message jsonb not null,
  variables jsonb not null default '{}',
  status text not null default 'queued' check(status in ('queued','sending','sent','failed','cancelled','uncertain')),
  due_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  foreign key(flow_id,store_id) references public.email_flows(id,store_id),
  unique(flow_id,event_key,recipient,step_index)
);
create index if not exists email_due on public.email_jobs(due_at) where status='queued';
create index if not exists email_store_history on public.email_jobs(store_id,created_at desc);

do $$ declare t text; begin
  foreach t in array array['email_settings','email_flows','email_contacts','email_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('drop policy if exists email_owner_read on public.%I',t);
    execute format('create policy email_owner_read on public.%I for select to authenticated using ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)))',t);
  end loop;
end $$;

-- Apenas funções autenticadas escrevem. Segredo nunca regressa ao browser.
create or replace function private.email_validate_steps(p_steps jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare s jsonb; b jsonb;
begin
  if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) not between 1 and 12 then return false; end if;
  for s in select value from jsonb_array_elements(p_steps) loop
    if coalesce(length(trim(s->>'subject')),0) not between 1 and 200 or s->>'subject' ~ E'[\r\n]'
      or coalesce(s->>'delay_minutes','') !~ '^[0-9]{1,6}$' or (s->>'delay_minutes')::integer>525600
      or jsonb_typeof(s->'blocks') is distinct from 'array' then return false; end if;
    if jsonb_array_length(s->'blocks') not between 1 and 40 then return false; end if;
    for b in select value from jsonb_array_elements(s->'blocks') loop
      if coalesce(b->>'type','') not in ('heading','text','image','button','divider') then return false; end if;
      if b->>'type'<>'divider' and (jsonb_typeof(b->'text') is distinct from 'string' or length(b->>'text')>10000) then return false; end if;
      if b->>'type' in ('image','button') and (coalesce(b->>'url','') !~ '^https://[^[:space:]]+$' or length(b->>'url')>2048) then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end $$;
revoke all on function private.email_validate_steps(jsonb) from public,anon,authenticated;

create or replace function public.email_save(p_store_id uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_secret uuid; v_result jsonb;
begin
  perform private.assert_staff_admin();
  if not private.auth_can_store(p_store_id) then raise exception 'store_denied'; end if;
  if p_action='settings' then
    if coalesce(p_data->>'host','') !~ '^[A-Za-z0-9][A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
      or coalesce(p_data->>'from_email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or length(coalesce(p_data->>'username','')) not between 1 and 320
      or length(coalesce(p_data->>'password',''))>1000 then raise exception 'invalid_settings'; end if;
    insert into public.email_settings(store_id,enabled,host,port,username,from_name,from_email,reply_to)
    values(p_store_id,(p_data->>'enabled')::boolean,p_data->>'host',(p_data->>'port')::integer,p_data->>'username',p_data->>'from_name',p_data->>'from_email',coalesce(p_data->>'reply_to',''))
    on conflict(store_id) do update set enabled=excluded.enabled,host=excluded.host,port=excluded.port,username=excluded.username,from_name=excluded.from_name,from_email=excluded.from_email,reply_to=excluded.reply_to,updated_at=now();
    if coalesce(p_data->>'password','') <> '' then
      select secret_id into v_secret from private.email_passwords where store_id=p_store_id;
      if v_secret is null then
        v_secret := vault.create_secret(p_data->>'password');
        insert into private.email_passwords values(p_store_id,v_secret);
      else perform vault.update_secret(v_secret,p_data->>'password'); end if;
      update public.email_settings set password_configured=true where store_id=p_store_id;
    end if;
    v_result := jsonb_build_object('ok',true);
  elsif p_action='flow' then
    if not private.email_validate_steps(p_data->'steps') then raise exception 'invalid_steps'; end if;
    v_id := coalesce((p_data->>'id')::uuid,gen_random_uuid());
    insert into public.email_flows(id,store_id,name,kind,trigger,status,steps)
      values(v_id,p_store_id,p_data->>'name',p_data->>'kind',p_data->>'trigger',p_data->>'status',p_data->'steps')
      on conflict(id) do update set name=excluded.name,status=excluded.status,steps=excluded.steps,updated_at=now()
      where email_flows.store_id=p_store_id and email_flows.kind=excluded.kind and email_flows.trigger=excluded.trigger;
    if not found then raise exception 'flow_conflict'; end if;
    if p_data->>'status'='archived' then update public.email_jobs set status='cancelled' where store_id=p_store_id and flow_id=v_id and status='queued'; end if;
    v_result := jsonb_build_object('id',v_id);
  elsif p_action='contact' then
    -- Uma subscrição cancelada não se reactiva por importar o mesmo endereço.
    insert into public.email_contacts(store_id,email,name,consent_source)
      values(p_store_id,lower(trim(p_data->>'email')),p_data->>'name',p_data->>'consent_source')
      on conflict(store_id,email) do update set name=excluded.name;
    v_result := jsonb_build_object('ok',true);
  elsif p_action='enrol' then
    select id into v_id from public.email_flows where id=(p_data->>'id')::uuid and store_id=p_store_id and kind='marketing' and trigger='manual' and status='active';
    if v_id is null then raise exception 'flow_not_active'; end if;
    select jsonb_build_object('queued',coalesce(sum(public.email_enrol(v_id,c.email,c.name,'manual')),0)) into v_result
      from public.email_contacts c where c.store_id=p_store_id and c.unsubscribed_at is null;
  elsif p_action='cancel_contact' then
    perform public.email_unsubscribe(unsubscribe_token) from public.email_contacts where id=(p_data->>'id')::uuid and store_id=p_store_id;
    v_result := jsonb_build_object('ok',true);
  else raise exception 'invalid_action'; end if;
  insert into public.event_log(store_id,actor_user_id,type,payload)
    values(p_store_id,auth.uid(),'email.'||p_action,jsonb_build_object('id',v_id));
  return v_result;
end $$;
revoke all on function public.email_save(uuid,text,jsonb) from public,anon;
grant execute on function public.email_save(uuid,text,jsonb) to authenticated;

create or replace function public.email_smtp(p_store_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$
  select to_jsonb(s)||jsonb_build_object('password',v.decrypted_secret)
  from public.email_settings s join private.email_passwords p using(store_id)
  join vault.decrypted_secrets v on v.id=p.secret_id join public.stores st on st.id=s.store_id
  where s.enabled and (p_store_id is null or s.store_id=p_store_id)
  order by st.sort,st.id limit 1
$$;
revoke all on function public.email_smtp(uuid) from public,anon,authenticated;
grant execute on function public.email_smtp(uuid) to service_role;

create or replace function public.email_enrol(p_flow_id uuid,p_email text,p_name text,p_event text,p_variables jsonb default '{}')
returns integer language plpgsql security definer set search_path='' as $$
declare f public.email_flows; n integer;
begin
  select * into f from public.email_flows where id=p_flow_id and status='active';
  if f.id is null or nullif(trim(p_email),'') is null then return 0; end if;
  if f.kind='marketing' and not exists(select 1 from public.email_contacts c where c.store_id=f.store_id and c.email=lower(trim(p_email)) and c.unsubscribed_at is null) then return 0; end if;
  insert into public.email_jobs(store_id,flow_id,event_key,recipient,step_index,message,variables,due_at)
  select f.store_id,f.id,p_event,lower(trim(p_email)),ordinality-1,value,
    p_variables||jsonb_build_object('nome',coalesce(p_name,''),'loja',(select name from public.stores where id=f.store_id)),
    case when ordinality=1 then now()+make_interval(mins=>(value->>'delay_minutes')::integer) end
  from jsonb_array_elements(f.steps) with ordinality on conflict do nothing;
  get diagnostics n=row_count;
  return n;
end $$;
revoke all on function public.email_enrol(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.email_enrol(uuid,text,text,text,jsonb) to service_role;

create or replace function public.email_unsubscribe(p_token uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.email_contacts;
begin
  update public.email_contacts set unsubscribed_at=coalesce(unsubscribed_at,now()) where unsubscribe_token=p_token returning * into c;
  update public.email_jobs j set status='cancelled' from public.email_flows f
    where j.flow_id=f.id and f.kind='marketing' and j.store_id=c.store_id and j.recipient=c.email and j.status='queued';
end $$;
revoke all on function public.email_unsubscribe(uuid) from public,anon,authenticated;
grant execute on function public.email_unsubscribe(uuid) to service_role;

create or replace function private.email_contact_created()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.email_enrol(f.id,new.email,new.name,'subscribed') from public.email_flows f
    where f.store_id=new.store_id and f.kind='marketing' and f.trigger='subscribed' and f.status='active';
  return new;
end $$;
drop trigger if exists email_contact_created on public.email_contacts;
create trigger email_contact_created after insert on public.email_contacts for each row execute function private.email_contact_created();

create or replace function private.email_order_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_event text;
begin
  if TG_OP='UPDATE' and old.status=new.status then return new; end if;
  v_event := case when new.status in ('approved','paid') then 'paid' when new.status in ('cancelled','ready','delivered') then new.status::text end;
  if v_event is null then return new; end if;
  perform public.email_enrol(f.id,new.customer_email,new.customer_name,new.id::text||':'||v_event,
    jsonb_build_object('pedido',new.order_number,'total_cents',new.total_cents))
    from public.email_flows f where f.store_id=new.store_id and f.kind='transactional' and f.trigger=v_event and f.status='active';
  return new;
exception when others then
  -- Best-effort: uma falha de email não pode reverter uma venda.
  raise warning 'email_queue_failed';
  return new;
end $$;
drop trigger if exists email_order_event on public.orders;
create trigger email_order_event after insert or update of status on public.orders for each row execute function private.email_order_event();

create or replace function public.email_claim()
returns setof public.email_jobs language plpgsql security definer set search_path='' as $$
begin
  -- DECISÃO: SMTP não oferece exactly-once. Uma interrupção fica incerta, nunca é reenviada automaticamente.
  update public.email_jobs set status='uncertain',error='Envio interrompido; confirmar no fornecedor.'
    where status='sending' and claimed_at < now()-interval '10 minutes';
  return query with picked as (
    select j.id from public.email_jobs j join public.email_flows f on f.id=j.flow_id
    where j.status='queued' and j.due_at<=now() and f.status='active'
      and exists(select 1 from public.email_settings s where s.store_id=j.store_id and s.enabled and s.password_configured)
      and (f.kind='transactional' or exists(select 1 from public.email_contacts c where c.store_id=j.store_id and c.email=j.recipient and c.unsubscribed_at is null))
    order by j.due_at,j.id limit 5 for update of j skip locked
  ) update public.email_jobs j set status='sending',claimed_at=now() from picked p where j.id=p.id returning j.*;
end $$;
revoke all on function public.email_claim() from public,anon,authenticated;
grant execute on function public.email_claim() to service_role;

create or replace function public.email_finish(p_id uuid,p_ok boolean,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j public.email_jobs;
begin
  update public.email_jobs set status=case when p_ok then 'sent' else 'failed' end,
    sent_at=case when p_ok then now() end,error=p_error where id=p_id and status='sending' returning * into j;
  if j.id is null then return; end if;
  if p_ok then
    update public.email_jobs set due_at=now()+make_interval(mins=>(message->>'delay_minutes')::integer)
      where flow_id=j.flow_id and store_id=j.store_id and event_key=j.event_key and recipient=j.recipient and step_index=j.step_index+1 and status='queued';
  end if;
end $$;
revoke all on function public.email_finish(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.email_finish(uuid,boolean,text) to service_role;
