import type { LocalDate } from "@nextdrop/rules";
import { addDays } from "@nextdrop/rules";
import { useQuery } from "@tanstack/react-query";
import { callApi } from "../../lib/api";

// What the Store screens read from the server. Every query key starts with "store", and the session module drops
// them all on sign-out, so the next user of the device never sees this outlet's data.

/** The signed-in manager's outlet: its name, ID, district and brand. The reference API scopes the list to it. */
export function useOutlet() {
  return useQuery({
    queryKey: ["store", "outlet"],
    queryFn: async () => (await callApi("outlets", { query: {} })).items[0] ?? null,
    staleTime: Infinity,
  });
}

/** The catalogue for the outlet's brand. */
export function useProducts() {
  return useQuery({
    queryKey: ["store", "products"],
    queryFn: async () => (await callApi("products", { query: {} })).items,
    staleTime: Infinity,
  });
}

/** Operating days for the dates the manager can choose. */
export function useCalendar(from: LocalDate, days: number) {
  return useQuery({
    queryKey: ["store", "calendar", from, days],
    queryFn: async () => (await callApi("calendar", { query: { from, to: addDays(from, days - 1) } })).items,
    staleTime: Infinity,
  });
}

/** The cutoff for a requested delivery date: when it closes, and the date an order placed now would really get. */
export function useCutoff(date: LocalDate | null) {
  return useQuery({
    queryKey: ["store", "cutoff", date],
    queryFn: () => callApi("storeCutoff", { query: { date: date! } }),
    enabled: date !== null,
    // The answer changes when the cutoff passes, so it is asked again each minute.
    refetchInterval: 60_000,
  });
}

/** The outlet's orders for the same weekday one week earlier. */
export function useLastWeekOrders(date: LocalDate | null) {
  return useQuery({
    queryKey: ["store", "orders", "last-week", date],
    queryFn: async () => (await callApi("storeOrders", { query: { date: addDays(date!, -7) } })).items,
    enabled: date !== null,
    staleTime: 5 * 60_000,
  });
}

/** The outlet's deliveries for a date: each order with its trip, and whether the driver is in contact. */
export function useDeliveries(date: LocalDate) {
  return useQuery({
    queryKey: ["store", "deliveries", date],
    queryFn: () => callApi("storeDeliveries", { query: { date } }),
    // The polling fallback of spec/sync/change-feed.md; a feed row refreshes it sooner.
    refetchInterval: 30_000,
  });
}

/** Orders the dispatcher has moved to a later day and not yet planned again. */
export function useDeferredOrders() {
  return useQuery({
    queryKey: ["store", "orders", "deferred"],
    queryFn: async () => (await callApi("storeOrders", { query: { status: "DEFERRED" } })).items,
    refetchInterval: 60_000,
  });
}
