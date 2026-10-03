import { readFileSync } from "node:fs";
import { computeEtas, validateTrip, type PlanTrip } from "@nextdrop/rules";
import { describe, expect, it } from "vitest";
import {
  HILL_DISTRICT,
  KANDY,
  loadReference,
  OUTPUT_FILE,
  parseCsv,
  pickStoryFixtures,
  readCommittedReference,
  REFERENCE_FILES,
  renderStoryFixtures,
  STORY_DATE,
  type ReadReference,
  type ReferenceFile,
} from "./pick-fixtures";

const AGENT_CONFIG = new URL("../../../../scripts/agent-context/config.json", import.meta.url);

/** Reads the committed CSVs with their data rows filtered or reordered. */
function readWith(change: (file: ReferenceFile, lines: string[]) => string[]): ReadReference {
  return (file) => {
    const [header, ...lines] = readCommittedReference(file).trim().split(/\r?\n/);
    return [header, ...change(file, lines)].join("\n");
  };
}

function hillTrip(fixtures: ReturnType<typeof pickStoryFixtures>): PlanTrip {
  const { trip } = fixtures.hillRun;
  return {
    ref: "T-hill",
    vehicleId: trip.vehicleId,
    tripNo: trip.tripNo,
    orders: trip.stopOutletIds.map((outletId) => ({
      id: `o-${outletId}`,
      outletId,
      temp: "chilled",
      weightG: 1000,
      volumeL: 1,
      deliveryDate: STORY_DATE,
    })),
  };
}

describe("pickStoryFixtures on the committed reference CSVs", () => {
  const ref = loadReference();
  const fixtures = pickStoryFixtures(ref);

  it("picks the recorded fixtures", () => {
    expect(fixtures).toEqual({
      storyDate: "2026-09-29",
      peakDay: { depot: "Peliyagoda", district: "Colombo", storeOutletId: "OUT004" },
      hillRun: {
        depot: "Kandy",
        district: "Nuwara Eliya",
        vehicleId: "VEH039",
        driverId: "DRV039",
        trip: {
          vehicleId: "VEH039",
          tripNo: 1,
          brand: "Fresh",
          district: "Nuwara Eliya",
          stopOutletIds: ["OUT105", "OUT108", "OUT104", "OUT106", "OUT107"],
        },
        storeOutletId: "OUT108",
        loaderLoginId: "LDR002",
      },
    });
  });

  it("puts a Kandy reefer truck on a valid Fresh trip into the hill district", () => {
    const vehicle = ref.vehicles.get(fixtures.hillRun.vehicleId);
    expect(vehicle).toMatchObject({ depot: KANDY, temp: "reefer", type: "truck" });
    expect(ref.districts.get(HILL_DISTRICT)).toMatchObject({ depot: KANDY, roadClass: "hill" });

    const trip = hillTrip(fixtures);
    expect(validateTrip(trip, ref, { date: STORY_DATE }).violations).toEqual([]);
    for (const id of fixtures.hillRun.trip.stopOutletIds) {
      expect(ref.outlets.get(id)).toMatchObject({ brand: "Fresh", depot: KANDY, district: HILL_DISTRICT });
    }
    expect(computeEtas(trip, ref).map((e) => e.outletId)).toEqual(fixtures.hillRun.trip.stopOutletIds);
  });

  it("binds the hill store to the trip's second stop, a Fresh outlet", () => {
    const { storeOutletId, trip } = fixtures.hillRun;
    expect(trip.stopOutletIds[1]).toBe(storeOutletId);
    expect(ref.outlets.get(storeOutletId)?.brand).toBe("Fresh");
  });

  it("picks a Colombo Fresh outlet served from Peliyagoda that a truck can serve", () => {
    const outlet = ref.outlets.get(fixtures.peakDay.storeOutletId);
    expect(outlet).toMatchObject({ brand: "Fresh", depot: "Peliyagoda", district: "Colombo", parking: "normal" });
  });

  it("falls back from Wellawatte because outlets.csv records no locality", () => {
    const [header] = readCommittedReference("outlets.csv").split(/\r?\n/);
    expect(header?.split(",")).toEqual([
      "outlet_id",
      "brand",
      "district",
      "depot",
      "dock_type",
      "parking_constraint",
      "mall_window",
      "window_open_time",
      "window_close_time",
    ]);
  });

  it("matches the committed story-fixtures.ts", () => {
    const committed = readFileSync(OUTPUT_FILE, "utf8").replace(/\r\n/g, "\n");
    expect(renderStoryFixtures(fixtures)).toBe(committed);
  });
});

describe("determinism and inputs", () => {
  it("gives byte-identical output on every run", () => {
    const first = renderStoryFixtures(pickStoryFixtures(loadReference()));
    const second = renderStoryFixtures(pickStoryFixtures(loadReference()));
    expect(second).toBe(first);
  });

  it("does not depend on the row order of the CSVs", () => {
    const reversed = loadReference(readWith((_, lines) => [...lines].reverse()));
    expect(pickStoryFixtures(reversed)).toEqual(pickStoryFixtures(loadReference()));
  });

  it("reads only approved reference CSVs", () => {
    const approved = (JSON.parse(readFileSync(AGENT_CONFIG, "utf8")) as { referenceCsvAllowed: string[] })
      .referenceCsvAllowed;
    const read: string[] = [];
    pickStoryFixtures(
      loadReference((file) => {
        read.push(file);
        return readCommittedReference(file);
      }),
    );
    expect([...read].sort()).toEqual([...REFERENCE_FILES].sort());
    for (const file of read) expect(approved).toContain(file);
  });
});

describe("when the criteria cannot be met", () => {
  it("fails without a Kandy reefer truck", () => {
    const ref = loadReference(
      readWith((file, lines) => (file === "vehicles.csv" ? lines.filter((l) => !/,reefer,.*,Kandy$/.test(l)) : lines)),
    );
    expect(() => pickStoryFixtures(ref)).toThrow(/no Kandy reefer truck/);
  });

  it("fails when the hill district has too few Fresh outlets", () => {
    const ref = loadReference(
      readWith((file, lines) => (file === "outlets.csv" ? lines.filter((l) => !/^OUT10[4-6],/.test(l)) : lines)),
    );
    expect(() => pickStoryFixtures(ref)).toThrow(/Fresh stops in Nuwara Eliya/);
  });

  it("fails when no Colombo Fresh outlet can take a truck", () => {
    const ref = loadReference(
      readWith((file, lines) =>
        file === "outlets.csv"
          ? lines.map((l) => (/,Fresh,Colombo,/.test(l) ? l.replace(",normal,", ",van_only,") : l))
          : lines,
      ),
    );
    expect(() => pickStoryFixtures(ref)).toThrow(/no Colombo Fresh outlet/);
  });

  it("parses CRLF files", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]);
  });
});
