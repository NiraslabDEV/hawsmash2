export type UpsellAttribution = { kind: 'companion' | 'upgrade'; qty: number; placement: string; fromVariantId?: string };
export function capUpsell(mark: UpsellAttribution | undefined, qty: number): UpsellAttribution | undefined {
  if (!mark || !Number.isInteger(mark.qty) || mark.qty <= 0 || qty <= 0) return undefined;
  return { ...mark, qty: Math.min(mark.qty, qty) };
}
export function mergeUpsell(a: UpsellAttribution | undefined, b: UpsellAttribution | undefined, qty: number): UpsellAttribution | undefined {
  if (!a) return capUpsell(b, qty);
  if (!b) return capUpsell(a, qty);
  // DECISÃO: bases diferentes não são somadas como se fossem a mesma oferta.
  if (a.kind !== b.kind || a.fromVariantId !== b.fromVariantId) return capUpsell(a, qty);
  return capUpsell({ ...a, qty: a.qty + b.qty }, qty);
}

export function reduceUpsell(mark: UpsellAttribution | undefined, oldQty: number, newQty: number) {
  return mark ? capUpsell({ ...mark, qty: mark.qty - Math.max(0, oldQty - newQty) }, newQty) : undefined;
}
