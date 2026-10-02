// Test-only: a deterministic, peak-day-like allocation input at Peliyagoda (spec/data/seed-and-demo.md 15.1 item 4).
import type { AllocationInput } from "../allocator";
import type { AllocationOrder } from "../ranking";
import type { ReferenceData } from "../reference";

/** Small deterministic PRNG (mulberry32), so fixtures never change between runs. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PEAK_DATE = "2026-09-29"; // Tue 29 Sep 2026, the story day.

export function peakDay(ref: ReferenceData, opts: { seed?: number; orders?: number } = {}): AllocationInput {
  const rnd = prng(opts.seed ?? 29);
  const count = opts.orders ?? 86;
  const outlets = [...ref.outlets.values()]
    .filter((o) => o.depot === "Peliyagoda")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const fresh = outlets.filter((o) => o.brand === "Fresh");
  const other = outlets.filter((o) => o.brand !== "Fresh");
  const between = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));
  const orders: AllocationOrder[] = [];
  for (let i = 0; i < count; i++) {
    const isFresh = rnd() < 0.72;
    const outlet = (isFresh ? fresh : other)[Math.floor(rnd() * (isFresh ? fresh.length : other.length))];
    if (!outlet) continue;
    const chilled = isFresh && rnd() < 0.5;
    const [kg, m3] =
      outlet.brand === "Fresh"
        ? chilled
          ? [between(200, 650), between(10, 30) / 10]
          : [between(300, 950), between(15, 50) / 10]
        : outlet.brand === "Style"
          ? [between(150, 500), between(40, 120) / 10]
          : [between(400, 1500), between(20, 60) / 10];
    const deferredBefore = rnd() < 0.12;
    orders.push({
      id: `ORD${10400 + i}`,
      outletId: outlet.id,
      brand: outlet.brand,
      temp: chilled ? "chilled" : "ambient",
      weightG: kg * 1000,
      volumeL: Math.round(m3 * 1000),
      deliveryDate: PEAK_DATE,
      requestedDate: deferredBefore ? "2026-09-28" : PEAK_DATE,
      status: deferredBefore ? "DEFERRED" : "ORDERED",
      deferredCount: deferredBefore ? (rnd() < 0.3 ? 2 : 1) : 0,
      deferredYesterday: deferredBefore,
      daysSinceLastServed: between(1, 12),
    });
  }
  // Several vehicles in the workshop, including a reefer and a van.
  return {
    date: PEAK_DATE,
    depot: "Peliyagoda",
    orders,
    unavailableVehicleIds: new Set([
      "VEH003",
      "VEH005",
      "VEH007",
      "VEH009",
      "VEH011",
      "VEH013",
      "VEH015",
      "VEH017",
      "VEH019",
      "VEH021",
      "VEH023",
      "VEH024",
      "VEH026",
      "VEH028",
      "VEH030",
      "VEH032",
      "VEH037",
    ]),
    breakdownVehicleIds: new Set(["VEH019"]),
  };
}
