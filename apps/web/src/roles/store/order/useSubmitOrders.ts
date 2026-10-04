import type { LocalDate } from "@nextdrop/rules";
import { useCallback, useState } from "react";
import { uuidv7 } from "uuidv7";
import { ApiRequestError, callApi } from "../../../lib/api";
import { queryClient } from "../../../lib/queryClient";
import { draft, keyFor, orderSignature, useDraft, type DraftLine, type Order, type Temp } from "./draft";

export interface SubmitFailure {
  /** `network`: the server was not reached. `rejected`: it answered with an error. */
  kind: "network" | "rejected";
  /** Orders the server confirmed before the failure. A retry returns the same ones, it does not place them again. */
  placedBefore: number;
}

/**
 * Place the draft: one `POST /store/orders` per temperature (ADR 0032). Each order carries an idempotency key that a
 * retry reuses, so pressing Submit again after a failure can never place an order twice. Resolves to null when every
 * order is confirmed, or to why it stopped.
 */
export async function placeOrders(
  date: LocalDate,
  orders: readonly { temp: Temp; lines: DraftLine[] }[],
): Promise<SubmitFailure | null> {
  const confirmed: Order[] = [];
  try {
    for (const { temp, lines } of orders) {
      const key = keyFor(useDraft.getState().keys[temp], orderSignature(date, lines), uuidv7);
      draft.rememberKey(temp, key);
      confirmed.push(
        await callApi("createOrder", {
          body: { requestedDate: date, lines: lines.map((line) => ({ productId: line.product.id, qty: line.qty })) },
          headers: { "idempotency-key": key.key },
        }),
      );
    }
  } catch (error) {
    const kind = error instanceof ApiRequestError && error.kind === "network" ? "network" : "rejected";
    return { kind, placedBefore: confirmed.length };
  }
  draft.placed(confirmed);
  void queryClient.invalidateQueries({ queryKey: ["store", "orders"] });
  return null;
}

export function useSubmitOrders() {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<SubmitFailure | null>(null);

  const submit = useCallback(async (date: LocalDate, orders: readonly { temp: Temp; lines: DraftLine[] }[]) => {
    setPending(true);
    setFailure(null);
    const failed = await placeOrders(date, orders);
    setFailure(failed);
    setPending(false);
    return failed === null;
  }, []);

  return { pending, failure, submit };
}
