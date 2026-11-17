// A1: 20 confirmações reais. Copia APENAS a estrutura local para uma BD descartável.
import { spawn } from 'node:child_process';
import { container, docker, sql, migrations } from './fiscal-local.mjs';
const db = `fiscal_ensaio_${Date.now()}`;
if (!/^fiscal_ensaio_\d+$/.test(db)) throw new Error('Base de ensaio inválida');
const store = 'f9100000-0000-4000-8000-000000000001';
function parallel(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q']);
    let error = ''; child.stderr.on('data', b => error += b); child.stdout.resume();
    child.on('error', reject); child.on('close', code => code ? reject(new Error(error)) : resolve());
    child.stdin.end(source);
  });
}
try {
  docker(['createdb', '-U', 'postgres', db]);
  const schema = docker(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only']);
  docker(['psql', '-X', '-U', 'supabase_admin', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q'], schema);
  sql(`begin; ${migrations()}
    insert into auth.users(id) values('f9200000-0000-4000-8000-000000000001');
    insert into public.staff_profiles(user_id,full_name,role) values('f9200000-0000-4000-8000-000000000001','PLACEHOLDER Operador','owner');
    select set_config('request.jwt.claim.sub','f9200000-0000-4000-8000-000000000001',true);
    insert into public.stores(id,slug,name,short_name,order_prefix) values('${store}','fiscal-concorrencia','PLACEHOLDER Loja','FC','FSC');
    select public.save_fiscal_settings('{"active":true,"legal_name":"PLACEHOLDER Empresa","nuit":"400000001","address":"PLACEHOLDER Sede"}');
    insert into public.orders(id,store_id,order_number,status,flow,fulfillment_type,channel,customer_name,payment_method,subtotal_cents,total_cents)
      select ('f9300000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${store}','FSC-'||i,'awaiting_payment','digital','pickup','pickup','PLACEHOLDER Cliente','mpesa',11600,11600 from generate_series(1,20) i;
    insert into public.order_items(order_id,store_id,name_snapshot,qty,unit_price_cents,station)
      select id,store_id,'PLACEHOLDER Artigo',1,11600,'kitchen' from public.orders where store_id='${store}';
    commit;`, db);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => {
    const id = `f9300000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    return parallel(`begin; select set_config('request.jwt.claims','{"role":"service_role"}',true);
      select public.confirm_payment('concorrencia-${index}', '${id}', 'paysuite',null,'mpesa',11600,'{}'); commit;`);
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  console.log(sql(`do $$ begin
    if (select count(*) from public.fiscal_documents where store_id='${store}' and doc_type='FR')<>20 then raise exception 'Faltam facturas'; end if;
    if exists(select 1 from (select number,row_number() over(order by number) n, emitted_at,lag(emitted_at) over(order by number) prev from public.fiscal_documents where store_id='${store}' and doc_type='FR') q where number<>n or emitted_at<prev) then raise exception 'Numeração ou hora inválida'; end if;
    if exists(select 1 from public.event_log where store_id='${store}' and type='fiscal.emit_failed') then raise exception 'Emissão falhou'; end if;
    end $$; select '20/20 FR, sequencia 1-20 unica e continua; emitted_at monotono' as resultado;`, db));
} finally {
  // Só esta BD, criada nesta execução. Nunca postgres nem a base de trabalho.
  docker(['dropdb', '-U', 'postgres', '--if-exists', db]);
}

