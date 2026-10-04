import type { ApiDto } from "@nextdrop/contracts";
import type { LocalDate } from "@nextdrop/rules";
import { create } from "zustand";
import { onSessionReset } from "../../../lib/session";

// The order being built. One draft covers the whole delivery date; it is sent as one order per temperature, because
// an order holds a single temperature (ADR 0032). That is why the screens say "2 orders".

export type Product = ApiDto<"product">;
export type Order = ApiDto<"order">;
export type Temp = Product["tempRequirement"];

/** Dry first, then chilled: the order the tabs, the summary and the submissions use. */
export const TEMPS = ["ambient", "chilled"] as const satisfies readonly Temp[];

export interface DraftLine {
  product: Product;
  qty: number;
}

/** The lines of one temperature, in catalogue order, leaving out products with no quantity. */
export function draftLines(
  products: readonly Product[],
  qty: Readonly<Record<string, number>>,
  temp: Temp,
): DraftLine[] {
  return products
    .filter((product) => product.tempRequirement === temp && (qty[product.id] ?? 0) > 0)
    .map((product) => ({ product, qty: qty[product.id]! }));
}

/** "Rice 5 kg · bag" */
export const productLabel = (product: Pick<Product, "name" | "unitLabel">) => `${product.name} · ${product.unitLabel}`;

/** Draft lines as the read-only rows the summary and review show. */
export const draftLineItems = (lines: readonly DraftLine[]) =>
  lines.map((line) => ({
    key: line.product.id,
    name: line.product.name,
    unitLabel: line.product.unitLabel,
    qty: line.qty,
  }));

export const totalUnits = (lines: readonly DraftLine[]) => lines.reduce((sum, line) => sum + line.qty, 0);

/** What an order is: its date and its lines. Two submissions with the same signature are the same order. */
export function orderSignature(date: LocalDate, lines: readonly DraftLine[]): string {
  return [date, ...lines.map((line) => `${line.product.id}:${line.qty}`).sort()].join("|");
}

export interface SubmissionKey {
  signature: string;
  key: string;
}

/**
 * The idempotency key for an order. A retry of the same order reuses the key, so the server returns the order it
 * already holds instead of making a second one. Once the order's content changes it is a different order and gets
 * a new key.
 */
export function keyFor(previous: SubmissionKey | undefined, signature: string, mint: () => string): SubmissionKey {
  return previous?.signature === signature ? previous : { signature, key: mint() };
}

/** Quantities by product from earlier orders: the source of "Repeat last week" and the "last Wed" hints. */
export function quantitiesOf(orders: readonly Order[]): Record<string, number> {
  const qty: Record<string, number> = {};
  for (const order of orders) {
    for (const line of order.lines) qty[line.productId] = (qty[line.productId] ?? 0) + line.qtyOrdered;
  }
  return qty;
}

interface DraftState {
  /** The delivery date the manager picked, or null to use the first date still open. */
  date: LocalDate | null;
  qty: Record<string, number>;
  keys: Partial<Record<Temp, SubmissionKey>>;
  /** The orders the server confirmed for the last submission, shown on the "Order placed" screen. */
  placed: Order[] | null;
}

const EMPTY: DraftState = { date: null, qty: {}, keys: {}, placed: null };

export const useDraft = create<DraftState>(() => EMPTY);

// The draft belongs to the signed-in manager. The next user of the device must not find, or submit, their quantities.
onSessionReset(() => useDraft.setState(EMPTY));

export const draft = {
  setDate: (date: LocalDate) => useDraft.setState({ date }),
  // Changing the draft starts the next order, so the last confirmation is put away.
  setQty: (productId: string, qty: number) =>
    useDraft.setState((state) => ({ qty: { ...state.qty, [productId]: Math.max(0, qty) }, placed: null })),
  /** Replace the quantities, keeping only products the catalogue still has. */
  fill: (qty: Readonly<Record<string, number>>, products: readonly Product[]) =>
    useDraft.setState({
      qty: Object.fromEntries(products.filter((p) => qty[p.id]).map((p) => [p.id, qty[p.id]!])),
      placed: null,
    }),
  rememberKey: (temp: Temp, key: SubmissionKey) =>
    useDraft.setState((state) => ({ keys: { ...state.keys, [temp]: key } })),
  /**
   * The orders are placed: show them, and take what was sent out of the draft. A product added while the request
   * was in flight was not sent, so it stays for the next order.
   */
  placed: (orders: Order[]) =>
    useDraft.setState((state) => {
      const sent = new Set(orders.flatMap((order) => order.lines.map((line) => line.productId)));
      return {
        placed: orders,
        qty: Object.fromEntries(Object.entries(state.qty).filter(([productId]) => !sent.has(productId))),
        keys: {},
      };
    }),
  dismissPlaced: () => useDraft.setState({ placed: null }),
};
