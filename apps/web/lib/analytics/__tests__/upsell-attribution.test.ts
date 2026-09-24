import { describe, expect, it } from 'vitest';
import { mergeUpsell, capUpsell, reduceUpsell } from '../upsell-attribution';
const offer = { kind: 'companion' as const, qty: 1, placement: 'online_companion' };
describe('atribuição de upsell no carrinho', () => {
  it('somar fora da oferta não aumenta unidades atribuídas', () => { expect(mergeUpsell(offer, undefined, 4)?.qty).toBe(1); });
  it('duas aceitações somam sem exceder a quantidade final', () => { expect(mergeUpsell(offer, offer, 2)?.qty).toBe(2); expect(capUpsell({...offer,qty:4},1)?.qty).toBe(1); });
  it('remover tudo limpa a atribuição e não aceita quantidades inválidas', () => { expect(capUpsell(offer,0)).toBeUndefined(); expect(capUpsell({...offer,qty:NaN},2)).toBeUndefined(); });
  it('remover uma oferta não atribui a unidade original', () => { expect(reduceUpsell(offer,2,1)).toBeUndefined(); });
  it('preserva a variante anterior do upgrade', () => { expect(capUpsell({kind:'upgrade',qty:2,placement:'online_upgrade',fromVariantId:'base'},1)).toEqual({kind:'upgrade',qty:1,placement:'online_upgrade',fromVariantId:'base'}); });
});
