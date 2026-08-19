export function parseMTInput(input: string): number | null {
  const normalized = input.trim().replace(/\s+/g, '').replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;

  const whole = Number(match[1]);
  const fractional = (match[2] ?? '').padEnd(2, '0');
  const value = whole * 100 + Number(fractional || '0');
  return Number.isSafeInteger(value) ? value : null;
}
