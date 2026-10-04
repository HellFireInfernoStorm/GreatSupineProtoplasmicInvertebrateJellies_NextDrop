import { useQuery } from "@tanstack/react-query";
import { callApi } from "../../lib/api";

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
  const runs = useQuery({
    queryKey: ["dispatch", depot, "runs"],
    queryFn: ({ signal }) => callApi("runs", { query: { depot }, signal }),
    refetchInterval: 30_000,
  });
  const exceptions = useQuery({
    queryKey: ["dispatch", depot, "exceptions"],
    queryFn: ({ signal }) => callApi("exceptions", { query: { depot }, signal }),
    refetchInterval: 30_000,
  });
  return { day, draft, outlets, vehicles, calendar, fleet, runs, exceptions };
}
export type PlanningQueries = ReturnType<typeof usePlanningData>;
