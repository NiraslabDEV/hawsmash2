-- ============================================================================
-- F5.2 — Estender validate_referral para devolver detalhes do item brinde
-- (gift_item_name, gift_item_photo_url) para o front mostrar o card do brinde.
-- CREATE OR REPLACE é idempotente; pode ser reaplicado.
-- ============================================================================

create or replace function public.validate_referral(
  p_code  text,
  p_phone text
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_rc         record;
  v_redeemed   int;
  v_gift_name  text;
  v_gift_photo text;
begin
  select * into v_rc
  from referral_codes
  where code = upper(trim(p_code))
    and active = true
    and (expires_at is null or expires_at > now());

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'invalid_or_expired');
  end if;

  if v_rc.owner_phone is not null and v_rc.owner_phone = p_phone then
    return jsonb_build_object('valid', false, 'reason', 'auto_redemption');
  end if;

  if exists (
    select 1 from referral_redemptions
    where code_id = v_rc.id and customer_phone = p_phone
  ) then
    return jsonb_build_object('valid', false, 'reason', 'already_redeemed');
  end if;

  select count(*) into v_redeemed
  from referral_redemptions where code_id = v_rc.id;

  if v_redeemed >= v_rc.max_redemptions then
    return jsonb_build_object('valid', false, 'reason', 'max_redemptions_reached');
  end if;

  -- Detalhes do item brinde (se free_item)
  if v_rc.reward_type = 'free_item' and v_rc.gift_item_id is not null then
    select name, photo_url into v_gift_name, v_gift_photo
    from menu_items where id = v_rc.gift_item_id;
  end if;

  return jsonb_build_object(
    'valid',               true,
    'reward_type',         v_rc.reward_type,
    'reward_value',        v_rc.reward_value,
    'gift_item_id',        v_rc.gift_item_id,
    'gift_item_name',      v_gift_name,
    'gift_item_photo_url', v_gift_photo
  );
end;
$$;

revoke all on function public.validate_referral(text, text) from public;
grant execute on function public.validate_referral(text, text) to anon, authenticated;
