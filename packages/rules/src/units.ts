// Integer units for the rules core (spec/domain/units-and-time.md, ADR 0018).
// Weight in grams, volume in litres, distance in metres, fuel in millilitres, time in minutes since local midnight.

export type Grams = number;
export type Litres = number;
export type Metres = number;
export type Millilitres = number;
/** Minutes since local midnight (Asia/Colombo), or a duration in minutes. */
export type Minutes = number;

/** Converts a decimal input (kg, m³, km, L, km/L) to its integer thousandth (g, L, m, mL, m/L), rounded to 3 decimals. */
export function toThousandths(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`not a finite number: ${value}`);
  return Math.round(value * 1000);
}

export const kgToGrams: (kg: number) => Grams = toThousandths;
export const m3ToLitres: (m3: number) => Litres = toThousandths;
export const kmToMetres: (km: number) => Metres = toThousandths;
export const litresToMillilitres: (litres: number) => Millilitres = toThousandths;
/** `km_per_l` as metres per litre. */
export const kmPerLitreToMetresPerLitre: (kmPerL: number) => number = toThousandths;

export const MINUTES_PER_DAY: Minutes = 24 * 60;

const CLOCK = /^([01]\d|2[0-4]):([0-5]\d)$/;

/** `"05:30"` -> 330. Accepts `00:00` to `24:00`. */
export function parseClock(hhmm: string): Minutes {
  const m = CLOCK.exec(hhmm.trim());
  if (!m) throw new RangeError(`not an HH:MM clock time: "${hhmm}"`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes > MINUTES_PER_DAY) throw new RangeError(`clock time after 24:00: "${hhmm}"`);
  return minutes;
}

/** 330 -> `"05:30"`. Minutes past midnight of the next day keep counting (`"25:10"`), so trip ETAs never wrap silently. */
export function formatClock(minutes: Minutes): string {
  if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError(`not a minute of the day: ${minutes}`);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A closed interval of minutes since local midnight. */
export interface TimeWindow {
  readonly open: Minutes;
  readonly close: Minutes;
}

/** `"10:30-12:30"` -> `{ open: 630, close: 750 }`. */
export function parseWindow(range: string): TimeWindow {
  const parts = range.split("-");
  if (parts.length !== 2) throw new RangeError(`not an HH:MM-HH:MM window: "${range}"`);
  return makeWindow(parseClock(parts[0] ?? ""), parseClock(parts[1] ?? ""));
}

export function makeWindow(open: Minutes, close: Minutes): TimeWindow {
  if (close < open) throw new RangeError(`window closes before it opens: ${open}-${close}`);
  return { open, close };
}

/** The overlap of two windows, or null when they do not overlap. */
export function intersectWindows(a: TimeWindow, b: TimeWindow): TimeWindow | null {
  const open = Math.max(a.open, b.open);
  const close = Math.min(a.close, b.close);
  return close < open ? null : { open, close };
}
