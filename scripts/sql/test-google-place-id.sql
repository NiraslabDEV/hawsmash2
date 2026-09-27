-- Ensaio da constraint real, sem alterar lojas nem outros dados: tudo faz rollback.
begin;
do $test$
declare
  definition text;
  candidate text;
begin
  select pg_get_constraintdef(oid) into strict definition
  from pg_constraint
  where conrelid = 'public.stores'::regclass and conname = 'stores_google_place_id_format';
  execute 'create temporary table place_id_check(google_place_id text ' || definition || ')';
  insert into place_id_check values
    (null), ('ChIJ582Y7VKb5h4RAj_5ZLpRQrI'), (repeat('a',10)), (repeat('a',256)), (repeat('a',512));
  foreach candidate in array array['',repeat('a',9),repeat('a',513),'https://g.page/r/abc/review','abcdefghij!'] loop
    begin
      insert into place_id_check values (candidate);
      raise exception 'Place ID inválido aceite';
    exception when check_violation then null;
    end;
  end loop;
end;
$test$;
rollback;
