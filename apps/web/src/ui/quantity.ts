export function parseQuantity(raw: string, min = -Infinity, max = Infinity): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}
export function nextQuantity(value: number, delta: number, min = -Infinity, max = Infinity): number | null {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(delta) || min > max) return null;
  const next = Math.min(max, Math.max(min, value + delta));
  return Number.isSafeInteger(next) ? next : null;
}
