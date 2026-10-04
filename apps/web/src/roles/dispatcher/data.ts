import { useQuery } from "@tanstack/react-query";
import { callApi } from "../../lib/api";

/** Today's runs (D4 and the dashboard share the cache). The change feed refreshes it; the interval is the fallback. */
export const runsQuery = (depot: string) => ({
  queryKey: ["dispatch", depot, "runs"],
  queryFn: ({ signal }: { signal: AbortSignal }) => callApi("runs", { query: { depot }, signal }),
  refetchInterval: 30_000,
});
export const exceptionsQuery = (depot: string) => ({
  queryKey: ["dispatch", depot, "exceptions"],
  queryFn: ({ signal }: { signal: AbortSignal }) => callApi("exceptions", { query: { depot }, signal }),
  refetchInterval: 30_000,
});

export function usePlanningData(depot: string, date: string) {
  const day = useQuery({
    queryKey: ["dispatch", depot, date, "day"],
    queryFn: ({ signal }) => callApi("dispatchDay", { params: { date }, query: { depot }, signal }),
  });
  const draft = useQuery({
    queryKey: ["dispatch", depot, date, "draft"],
    queryFn: ({ signal }) => callApi("getDraft", { params: { date }, query: { depot }, signal }),
  });
  const outlets = useQuery({
    queryKey: ["dispatch", depot, "outlets"],
    queryFn: ({ signal }) => callApi("outlets", { query: { depot }, signal }),
  });
  const vehicles = useQuery({
    queryKey: ["dispatch", depot, "vehicles"],
    queryFn: ({ signal }) => callApi("vehicles", { query: { depot }, signal }),
  });
  const calendar = useQuery({
    queryKey: ["dispatch", date, "calendar"],
    queryFn: ({ signal }) => callApi("calendar", { query: { from: date, to: date }, signal }),
  });
  const fleet = useQuery({
    queryKey: ["dispatch", depot, date, "fleet"],
    queryFn: ({ signal }) => callApi("getFleet", { query: { date }, signal }),
  });
  const runs = useQuery(runsQuery(depot));
  const exceptions = useQuery(exceptionsQuery(depot));
  return { day, draft, outlets, vehicles, calendar, fleet, runs, exceptions };
}
export type PlanningQueries = ReturnType<typeof usePlanningData>;
