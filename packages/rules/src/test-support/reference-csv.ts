// Test-only: loads the committed reference CSVs from data/reference/. Never imported by package code.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CsvRow, ReferenceData } from "../reference";
import {
  buildReferenceData,
  calendarDayFromRow,
  districtTravelFromRow,
  outletFromRow,
  serviceAllowanceFromRow,
  vehicleFromRow,
} from "../reference";

const REFERENCE_DIR = fileURLToPath(new URL("../../../../data/reference/", import.meta.url));

/** Parses a simple CSV (no quoted fields, which the reference files do not use). */
export function readCsv(name: string): CsvRow[] {
  const [header, ...lines] = readFileSync(REFERENCE_DIR + name, "utf8")
    .trim()
    .split(/\r?\n/);
  const cols = (header ?? "").split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

let cached: ReferenceData | undefined;

export function loadReferenceData(): ReferenceData {
  cached ??= buildReferenceData({
    outlets: readCsv("outlets.csv").map(outletFromRow),
    vehicles: readCsv("vehicles.csv").map(vehicleFromRow),
    districts: readCsv("district_travel.csv").map(districtTravelFromRow),
    serviceAllowances: readCsv("service_allowance.csv").map(serviceAllowanceFromRow),
    calendar: readCsv("calendar.csv").map(calendarDayFromRow),
  });
  return cached;
}
