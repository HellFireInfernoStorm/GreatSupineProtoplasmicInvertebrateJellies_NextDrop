/** UI paging only: preserve the supplied order and never change the planning draft. */
export const UNASSIGNED_PAGE_SIZE = 4;
export interface UnassignedPagingState {
  readonly scope: string;
  readonly index: number;
}

/** A new depot/day/draft scope starts at zero; changes within a scope clamp to a nonempty page. */
export function pageUnassigned<T>(orders: readonly T[], scope: string, previous: UnassignedPagingState | null = null) {
  const total = orders.length;
  const pageCount = Math.ceil(total / UNASSIGNED_PAGE_SIZE);
  const requested = previous?.scope === scope && Number.isFinite(previous.index) ? Math.trunc(previous.index) : 0;
  const index = Math.max(0, Math.min(requested, Math.max(0, pageCount - 1)));
  const offset = index * UNASSIGNED_PAGE_SIZE;
  return {
    state: { scope, index },
    items: orders.slice(offset, offset + UNASSIGNED_PAGE_SIZE),
    total,
    pageCount,
    from: total ? offset + 1 : 0,
    to: Math.min(offset + UNASSIGNED_PAGE_SIZE, total),
  };
}
