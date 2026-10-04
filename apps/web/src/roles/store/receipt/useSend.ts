import { useCallback, useState } from "react";
import { ApiRequestError } from "../../../lib/api";
import { queryClient } from "../../../lib/queryClient";

/** `network`: the server was not reached. `rejected`: it answered with an error. */
export type SendFailure = "network" | "rejected";

/** Runs one Store write. On success every Store query is refreshed, so each screen shows the order's new state. */
export function useSend() {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<SendFailure | null>(null);
  const send = useCallback(async (write: () => Promise<unknown>): Promise<boolean> => {
    setPending(true);
    setFailure(null);
    try {
      await write();
    } catch (error) {
      setFailure(error instanceof ApiRequestError && error.kind === "network" ? "network" : "rejected");
      setPending(false);
      return false;
    }
    await queryClient.invalidateQueries({ queryKey: ["store"] });
    setPending(false);
    return true;
  }, []);
  return { pending, failure, send };
}
