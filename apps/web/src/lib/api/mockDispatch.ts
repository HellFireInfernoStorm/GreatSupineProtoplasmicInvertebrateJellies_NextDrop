import { apiFixtures, type ApiDtoInput, type ApiRouteName } from "@nextdrop/contracts";
import { addDays, calendarDay, dayOfWeek, isoWeekOf } from "@nextdrop/rules";
import { readStored, writeStored } from "../storage";
import { MOCK_CALENDAR } from "./mockCalendar";
import { mockId } from "./mockStore";
import type { RawResponse, TransportRequest } from "./types";

// D4 Delivery Progress in mock mode (VITE_API_MOCK=true), after the walkthrough (spec/data/seed-and-demo.md §15.4) on
// the Kandy fixture trip (ADR 0008): VEH039 driven by Sampath on the Nuwara Eliya hill run.
//
// Open `/dispatch/runs?mock=<moment>` to switch; the choice lasts for the tab.
//   nosignal   step 10: the Kandy truck is out of signal after stop 1 (the default)
//   escalated  the same, and now behind schedule
//   synced     steps 12 and 14: the phone synced; a sync clash, a store dispute and a dock shortfall wait
// Resolving an item removes it until the moment changes. Times are set around now, so the screen looks live.

export const DISPATCH_MOMENTS = ["nosignal", "escalated", "synced"] as const;
type Moment = (typeof DISPATCH_MOMENTS)[number];
type Run = ApiDtoInput<"run">;
type Stop = ApiDtoInput<"stop">;
type Exception = ApiDtoInput<"exception">;

const MOMENT_KEY = "nextdrop.mock.dispatch";
const RESOLVED_KEY = "nextdrop.mock.dispatch.resolved";
const MIN = 60_000;

const isMoment = (value: string | null): value is Moment => DISPATCH_MOMENTS.some((m) => m === value);

function moment(): Moment {
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(window.location.search).get("mock");
  } catch {
    // No window (tests): the default moment.
  }
  if (isMoment(asked) && asked !== readStored(MOMENT_KEY, "session")) {
    writeStored(MOMENT_KEY, asked, "session");
    writeStored(RESOLVED_KEY, null, "session");
  }
  const stored = readStored(MOMENT_KEY, "session");
  return isMoment(stored) ? stored : "nosignal";
}
const resolved = () => new Set((readStored(RESOLVED_KEY, "session") ?? "").split(",").filter(Boolean));
function resolve(id: string) {
  writeStored(RESOLVED_KEY, [...resolved(), id].join(","), "session");
}

const iso = (ms: number) => new Date(ms).toISOString();
/** Minutes after local midnight in Colombo, as an instant on the day of `nowMs`. */
function at(nowMs: number, minute: number): string {
  const day = new Date(nowMs + 330 * MIN).toISOString().slice(0, 10);
  return iso(Date.parse(`${day}T00:00:00+05:30`) + minute * MIN);
}

const CONFLICT_ID = mockId(61);
const ISSUE_ID = mockId(62);

function outlet(n: number, displayId: string, name: string, district: string, depot: string) {
  return { ...apiFixtures.outlet, id: mockId(n), displayId, name, district, depot };
}
function stop(
  n: number,
  seq: number,
  order: { displayId: string; status: Stop["order"]["status"]; temp?: "chilled" | "ambient" },
  place: ReturnType<typeof outlet>,
  eta: string,
  times: { deliveredAt?: string; confirmedAt?: string } = {},
): Stop {
  return {
    ...apiFixtures.stop,
    id: mockId(n),
    seq,
    order: {
      ...apiFixtures.order,
      id: mockId(n + 1),
      displayId: order.displayId,
      outletId: place.id,
      status: order.status,
      tempRequirement: order.temp ?? "chilled",
    },
    outlet: place,
    etaFrom: eta,
    etaTo: iso(Date.parse(eta) + 30 * MIN),
    deliveredAt: times.deliveredAt ?? null,
    confirmedAt: times.confirmedAt ?? null,
  };
}
function vehicle(n: number, displayId: string, depot: string, driver: string) {
  return {
    ...apiFixtures.vehicle,
    id: mockId(n),
    displayId,
    depot,
    driver: { name: driver, phone: "+94 77 123 4567" },
  };
}
function run(
  v: ReturnType<typeof vehicle>,
  trip: { n: number; displayId: string; district: string; status: Run["trips"][number]["status"]; depart: string },
  stops: Stop[],
  state: Partial<Run>,
): Run {
  return {
    vehicle: v,
    trips: [
      {
        ...apiFixtures.trip,
        id: mockId(trip.n),
        displayId: trip.displayId,
        vehicleId: v.id,
        district: trip.district,
        status: trip.status,
        plannedDepart: trip.depart,
        stops,
      },
    ],
    stopsDone: 0,
    stopsTotal: stops.length,
    lastHeardAt: null,
    lastSyncAt: null,
    pendingCount: 0,
    lateRisk: false,
    state: "ON_TRACK",
    ...state,
  };
}

function story(nowMs: number) {
  const m = moment();
  const synced = m === "synced";
  const ne = (n: number, id: string, name: string) => outlet(n, id, name, "Nuwara Eliya", "Kandy");
  const out105 = ne(10, "OUT105", "Waypoint Fresh Talawakele");
  const out104 = ne(11, "OUT104", "Waypoint Fresh Lindula");
  const out106 = ne(12, "OUT106", "Waypoint Fresh Pattipola");
  const out107 = ne(13, "OUT107", "Waypoint Fresh Nanu Oya");
  const delivered1 = at(nowMs, 5 * 60 + 24);
  const delivered2 = at(nowMs, 6 * 60 + 12);
  const sync = iso(nowMs - 6 * MIN);
  // Stop 1 delivered online. Stops 2 (the hill store, two orders) delivered offline; the third stop, OUT106, was
  // cancelled by the dispatcher while the phone was silent, so it is no longer on the trip.
  const kandyStops = [
    stop(20, 1, { displayId: "ORD10405", status: synced ? "RECEIVED" : "DELIVERED" }, out105, at(nowMs, 5 * 60 + 21), {
      deliveredAt: delivered1,
      confirmedAt: iso(Date.parse(delivered1) + MIN),
    }),
    stop(
      22,
      2,
      { displayId: "ORD10412", status: synced ? "DELIVERED" : "OUT_FOR_DELIVERY" },
      out104,
      at(nowMs, 5 * 60 + 56),
      synced ? { deliveredAt: delivered2, confirmedAt: sync } : {},
    ),
    stop(
      24,
      3,
      { displayId: "ORD10468", status: synced ? "DELIVERED" : "OUT_FOR_DELIVERY", temp: "ambient" },
      out104,
      at(nowMs, 6 * 60 + 31),
      synced ? { deliveredAt: iso(Date.parse(delivered2) + 4 * MIN), confirmedAt: sync } : {},
    ),
    // Cancelled by the dispatcher at step 10, so it leaves the trip once the phone has synced.
    ...(synced
      ? []
      : [stop(28, 4, { displayId: "ORD10471", status: "OUT_FOR_DELIVERY" }, out106, at(nowMs, 7 * 60 + 6))]),
    stop(26, synced ? 4 : 5, { displayId: "ORD10483", status: "OUT_FOR_DELIVERY" }, out107, at(nowMs, 7 * 60 + 41)),
  ];
  const kandy = run(
    vehicle(30, "VEH039", "Kandy", "Sampath"),
    { n: 31, displayId: "T004", district: "Nuwara Eliya", status: "DEPARTED", depart: at(nowMs, 3 * 60 + 30) },
    kandyStops,
    synced
      ? { stopsDone: 3, lastHeardAt: sync, lastSyncAt: sync, state: "ON_TRACK" }
      : {
          stopsDone: 1,
          lastHeardAt: iso(nowMs - 34 * MIN),
          lastSyncAt: iso(Date.parse(delivered1) + MIN),
          pendingCount: 3,
          lateRisk: m === "escalated",
          state: m === "escalated" ? "ESCALATED" : "NO_SIGNAL",
        },
  );
  const col = (n: number, id: string, name: string) => outlet(n, id, name, "Colombo", "Peliyagoda");
  const mount = col(40, "OUT021", "Waypoint Fresh Mount Lavinia");
  const late = run(
    vehicle(41, "VEH003", "Peliyagoda", "Ruwan S."),
    { n: 42, displayId: "T003", district: "Colombo", status: "DEPARTED", depart: at(nowMs, 4 * 60) },
    [1, 2, 3, 4, 5, 6].map((seq) =>
      stop(
        42 + seq * 2,
        seq,
        { displayId: `ORD104${20 + seq}`, status: seq <= 3 ? "DELIVERED" : "OUT_FOR_DELIVERY" },
        seq === 4 ? mount : col(60 + seq, `OUT0${30 + seq}`, "Waypoint Fresh Dehiwala"),
        at(nowMs, 5 * 60 + seq * 30),
        seq <= 3 ? { deliveredAt: at(nowMs, 5 * 60 + seq * 30), confirmedAt: at(nowMs, 5 * 60 + seq * 30 + 1) } : {},
      ),
    ),
    { stopsDone: 3, lastHeardAt: iso(nowMs - 3 * MIN), lastSyncAt: iso(nowMs - 3 * MIN), lateRisk: true },
  );
  const done = run(
    vehicle(70, "VEH021", "Peliyagoda", "Kamal"),
    { n: 71, displayId: "T007", district: "Colombo", status: "COMPLETE", depart: at(nowMs, 4 * 60 + 30) },
    [1, 2, 3].map((seq) =>
      stop(
        72 + seq * 2,
        seq,
        { displayId: `ORD104${40 + seq}`, status: "DELIVERED", temp: "ambient" },
        col(80 + seq, `OUT0${50 + seq}`, "Waypoint Style Borella"),
        at(nowMs, 5 * 60 + seq * 25),
        { deliveredAt: at(nowMs, 5 * 60 + seq * 25), confirmedAt: at(nowMs, 5 * 60 + seq * 25 + 1) },
      ),
    ),
    { stopsDone: 3, lastHeardAt: at(nowMs, 6 * 60 + 45), lastSyncAt: at(nowMs, 6 * 60 + 45), state: "DONE" },
  );
  const laterRun = run(
    vehicle(90, "VEH007", "Peliyagoda", "Nuwan"),
    { n: 91, displayId: "T009", district: "Gampaha", status: "READY", depart: at(nowMs, 10 * 60 + 30) },
    [
      stop(
        92,
        1,
        { displayId: "ORD10490", status: "LOADED" },
        col(95, "OUT062", "Waypoint Tech Gampaha"),
        at(nowMs, 11 * 60),
      ),
    ],
    {},
  );
  const runs = [kandy, late, done, laterRun];

  const exceptions: Exception[] = [];
  if (synced) {
    exceptions.push(
      {
        type: "CONFLICT",
        conflict: {
          ...apiFixtures.conflict,
          id: CONFLICT_ID,
          kind: "FACT_ON_CANCELLED_STOP",
          orderId: mockId(29),
          tripId: mockId(31),
          openedAt: sync,
        },
        evidence: [mockId(97)],
      },
      {
        type: "ISSUE",
        issue: {
          ...apiFixtures.issue,
          id: ISSUE_ID,
          orderId: mockId(25),
          kind: "SHORT",
          openedAt: iso(nowMs - 2 * MIN),
          note: "2 packs of rice missing from the dry order",
        },
        evidence: [mockId(98)],
      },
    );
  }
  exceptions.push(
    { type: "SHORT", orderId: mockId(27), lineId: apiFixtures.order.lines[0]!.id, qtyShort: 4, resolution: null },
    {
      type: "ACK",
      tripId: mockId(31),
      planVersion: 2,
      actor: { userId: mockId(99), role: "DRIVER" },
      at: synced ? sync : at(nowMs, 3 * 60 + 25),
    },
  );
  // The clash names ORD10471 at OUT106 when the screen saw the stop before it was cancelled (open `nosignal` first).
  return {
    runs,
    exceptions: exceptions.filter((item) => {
      const id =
        item.type === "CONFLICT"
          ? item.conflict.id
          : item.type === "ISSUE"
            ? item.issue.id
            : item.type === "SHORT"
              ? `${item.orderId}:${item.lineId}`
              : null;
      return id === null || !resolved().has(id);
    }),
  };
}

// D5 Capacity outlook: seven weeks of forecast against 367 m³ of usable fleet and 152 m³ of reefers (ADR 0055). Payday
// weeks of the mock calendar run tight; the festival week (or the sixth week, when the window has no festival) goes
// over both limits.
type OutlookItem = ApiDtoInput<"outlookResponse">["items"][number];
const FLEET_M3 = 367;
const REEFER_M3 = 152;
/** [forecast, chilled] in m³ for an ordinary week, by ISO week, then for payday weeks and the peak week. */
const ORDINARY_WEEKS = [
  [318, 131],
  [309, 128],
  [326, 135],
  [331, 137],
  [314, 129],
  [322, 133],
  [329, 136],
] as const;
const PAYDAY_WEEKS = [
  [352, 146],
  [360, 149],
] as const;
const PEAK_WEEK = [398, 172] as const;

function outlook(from: string, weeks: number): OutlookItem[] {
  const firstMonday = addDays(from, -dayOfWeek(from));
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(firstMonday, 7 * i));
  const days = (monday: string) => Array.from({ length: 7 }, (_, d) => calendarDay(addDays(monday, d), MOCK_CALENDAR));
  const festivalWeek = mondays.findIndex((monday) => days(monday).some((day) => day.festival !== null));
  const peak = festivalWeek >= 0 ? festivalWeek : Math.min(5, weeks - 1);
  let paydays = 0;
  return mondays.flatMap((monday, i) => {
    const { isoYear, isoWeek } = isoWeekOf(monday);
    const [total, chilled] =
      i === peak
        ? PEAK_WEEK
        : days(monday).some((day) => day.isPayday)
          ? PAYDAY_WEEKS[paydays++ % PAYDAY_WEEKS.length]!
          : ORDINARY_WEEKS[isoWeek % ORDINARY_WEEKS.length]!;
    // Chilled is Fresh only; the rest of the forecast splits across the three brands.
    const fresh = chilled + Math.round((total - chilled) * 0.25);
    const style = Math.round((total - fresh) * 0.55);
    const split = [
      ["Fresh", fresh, chilled],
      ["Style", style, 0],
      ["Tech", total - fresh - style, 0],
    ] as const;
    return split.map(([brand, demand, chilledM3]) => ({
      isoYear,
      isoWeek,
      brand,
      demandVolumeL: demand * 1000,
      chilledVolumeL: chilledM3 * 1000,
      capacityVolumeL: FLEET_M3 * 1000,
      reeferCapacityVolumeL: REEFER_M3 * 1000,
    }));
  });
}

export function mockDispatchRespond(
  request: Pick<TransportRequest, "name" | "url" | "body">,
  nowMs: number,
): RawResponse | null {
  const name: ApiRouteName = request.name;
  const serverTime = new Date(nowMs).toISOString();
  const params = new URL(request.url, "http://mock.local").pathname.split("/");
  switch (name) {
    case "runs":
      return { status: 200, body: { items: story(nowMs).runs, serverTime } };
    case "outlook": {
      const query = new URL(request.url, "http://mock.local").searchParams;
      const from = query.get("from");
      const weeks = Number(query.get("weeks"));
      if (!from || !(weeks > 0)) return null;
      return { status: 200, body: { items: outlook(from, Math.min(weeks, 52)), serverTime } };
    }
    case "exceptions":
      return { status: 200, body: { items: story(nowMs).exceptions } };
    case "resolveConflict":
    case "resolveIssue": {
      const id = params[4]!;
      if (resolved().has(id)) return { status: 409, body: apiFixtures.apiError };
      resolve(id);
      return { status: 200, body: { ok: true, serverTime } };
    }
    case "resolveShort": {
      // /api/dispatch/orders/:id/shorts/:lineId/resolve
      resolve(`${params[4]}:${decodeURIComponent(params[6]!)}`);
      return { status: 200, body: { ...apiFixtures.resolveShortResponse, serverTime } };
    }
    default:
      return null;
  }
}
