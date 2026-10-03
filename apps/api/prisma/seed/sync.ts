// Compare-and-write for seeded rows keyed by a natural key: create what is missing, update what differs, leave the
// rest untouched, so a second run writes nothing.

export interface SyncResult {
  created: number;
  updated: number;
}

export function wrote(result: SyncResult): boolean {
  return result.created + result.updated > 0;
}

/** Decimal-aware equality between a stored value and the value the seed wants. */
export function sameValue(stored: unknown, wanted: unknown): boolean {
  if (wanted === null || wanted === undefined) return stored === null || stored === undefined;
  if (stored === null || stored === undefined) return false;
  if (wanted instanceof Date) return stored instanceof Date && stored.getTime() === wanted.getTime();
  if (typeof wanted === "string" && typeof stored === "object") {
    // Prisma returns Decimal columns as Decimal objects; the seed writes their CSV text.
    return Number(String(stored)) === Number(wanted);
  }
  if (typeof wanted === "object") return JSON.stringify(stored) === JSON.stringify(wanted);
  return stored === wanted;
}

/** The fields of `wanted` whose stored value differs, or null when the row is up to date. */
export function changedFields<R extends object>(stored: object, wanted: R): Partial<R> | null {
  const changes: Record<string, unknown> = {};
  let changed = false;
  for (const [field, value] of Object.entries(wanted)) {
    if (!sameValue((stored as Record<string, unknown>)[field], value)) {
      changes[field] = value;
      changed = true;
    }
  }
  return changed ? (changes as Partial<R>) : null;
}

export async function syncRows<R extends object, E extends { id: string }>(opts: {
  rows: readonly R[];
  key: (row: R) => string;
  existing: () => Promise<E[]>;
  create: (rows: R[]) => Promise<unknown>;
  update: (id: string, data: Partial<R>) => Promise<unknown>;
}): Promise<SyncResult> {
  const stored = new Map<string, E>();
  for (const row of await opts.existing()) stored.set(opts.key(row as unknown as R), row);

  const seen = new Set<string>();
  const missing: R[] = [];
  let updated = 0;
  for (const row of opts.rows) {
    const key = opts.key(row);
    if (seen.has(key)) throw new RangeError(`duplicate seed key ${key}`);
    seen.add(key);
    const current = stored.get(key);
    if (!current) {
      missing.push(row);
      continue;
    }
    const changes = changedFields(current, row);
    if (changes) {
      await opts.update(current.id, changes);
      updated++;
    }
  }
  if (missing.length) await opts.create(missing);
  return { created: missing.length, updated };
}
