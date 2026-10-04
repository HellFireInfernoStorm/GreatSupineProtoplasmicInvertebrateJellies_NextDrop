import { describe, expect, it } from "vitest";
import { apiFixtures, type ApiDto } from "@nextdrop/contracts";
import { addDays, isoWeekOf } from "@nextdrop/rules";
import { buildOutlook, chartScale, loadLevel, outlookWindow } from "./outlook-model";

type Item = ApiDto<"outlookResponse">["items"][number];

// The design's seven weeks (Figma 277:1215), W40 to W46 of 2026, in m³: [forecast, chilled].
const DESIGN = [
  [352, 146],
  [318, 131],
  [309, 128],
  [326, 135],
  [360, 149],
  [398, 172],
  [331, 137],
] as const;
const FIRST_MONDAY = "2026-09-28";

function items(weeks: readonly (readonly [number, number])[], fleet = 367, start = FIRST_MONDAY, reefer = 152): Item[] {
  return weeks.flatMap(([total, chilled], i) => {
    const { isoYear, isoWeek } = isoWeekOf(addDays(start, 7 * i));
    const row = { isoYear, isoWeek, capacityVolumeL: fleet * 1000, reeferCapacityVolumeL: reefer * 1000 };
    return [
      { ...row, brand: "Fresh" as const, demandVolumeL: (chilled + 50) * 1000, chilledVolumeL: chilled * 1000 },
      { ...row, brand: "Style" as const, demandVolumeL: (total - chilled - 80) * 1000, chilledVolumeL: 0 },
      { ...row, brand: "Tech" as const, demandVolumeL: 30 * 1000, chilledVolumeL: 0 },
    ];
  });
}
const day = (date: string, flags: { isPayday?: boolean; festival?: string; festivalRamp?: number }) => ({
  ...apiFixtures.calendarDay,
  date,
  isPayday: flags.isPayday ?? false,
  festival: flags.festival ?? null,
  festivalRamp: flags.festivalRamp ?? 0,
});
const calendar = [
  day("2026-09-30", { isPayday: true }),
  day("2026-10-31", { isPayday: true }),
  day("2026-11-07", { festival: "deepavali", festivalRamp: 0.6 }),
  day("2026-11-08", { festival: "deepavali", festivalRamp: 1 }),
];

describe("capacity outlook", () => {
  it("starts on the Monday of the planning date's ISO week and covers seven weeks", () => {
    expect(outlookWindow("2026-10-01")).toEqual({ from: "2026-09-28", to: "2026-11-15", weeks: 7 });
    expect(outlookWindow("2026-09-28").from).toBe("2026-09-28");
    expect(outlookWindow("2026-10-04").from).toBe("2026-09-28");
  });

  it("labels load tight at 95% and over above 100%", () => {
    expect(loadLevel(94)).toBe("ok");
    expect(loadLevel(95)).toBe("tight");
    expect(loadLevel(100)).toBe("tight");
    expect(loadLevel(101)).toBe("over");
    expect(loadLevel(null, 5)).toBe("over");
    expect(loadLevel(null, 0)).toBe("ok");
  });

  it("sums brands per week and reproduces the design's stats and flags", () => {
    const model = buildOutlook("2026-10-01", items(DESIGN), calendar)!;
    expect(model.weeks.map((w) => [w.isoWeek, w.demandM3, w.chilledM3, w.loadPercent, w.chilledLoadPercent])).toEqual([
      [40, 352, 146, 96, 96],
      [41, 318, 131, 87, 86],
      [42, 309, 128, 84, 84],
      [43, 326, 135, 89, 89],
      [44, 360, 149, 98, 98],
      [45, 398, 172, 108, 113],
      [46, 331, 137, 90, 90],
    ]);
    expect(model.weeks[0]).toMatchObject({ monday: "2026-09-28", saturday: "2026-10-03", payday: true });
    expect(model.weeks[5]!.festival).toEqual({ name: "deepavali", date: "2026-11-08" });
    expect(model.peak.isoWeek).toBe(45);
    expect(model.peak.level).toBe("over");
    expect(model.chilledPeak.chilledM3 - model.chilledPeak.reeferM3).toBe(20);
    expect(model.paydayWeeks.map((w) => w.isoWeek)).toEqual([40, 44]);
    expect(model.paydayRange).toEqual([96, 98]);
    expect(model.paydayLevel).toBe("tight");
    expect(model.headroomWeeks.map((w) => w.isoWeek)).toEqual([41, 42, 43, 46]);
  });

  it("explains over-capacity weeks, the reefer booking date and tight payday weeks", () => {
    const model = buildOutlook("2026-10-01", items(DESIGN), calendar)!;
    expect(
      model.insights.map((i) => [i.kind, "week" in i ? i.week.isoWeek : null, "bookBy" in i ? i.bookBy : null]),
    ).toEqual([
      ["overFleet", 45, null],
      ["overReefer", 45, "2026-10-23"],
      ["paydayTight", null, null],
    ]);
    expect(model.insights[2]).toMatchObject({ range: [96, 98] });
  });

  it("asks for a reefer now when the booking date has passed", () => {
    // Planning on Wednesday of W44 with W44 over: its Friday-before-last has passed.
    const model = buildOutlook("2026-10-28", items(DESIGN.slice(5), 367, "2026-10-26"), [])!;
    expect(model.insights.find((i) => i.kind === "overReefer")).toMatchObject({ bookBy: null });
  });

  it("names non-payday tight weeks, and says when every week has headroom", () => {
    const tight = buildOutlook(
      "2026-10-01",
      items([
        [300, 100],
        [350, 100],
      ]),
      [],
    )!;
    expect(tight.insights).toMatchObject([{ kind: "tight", weeks: [{ isoWeek: 41 }] }]);
    const calm = buildOutlook(
      "2026-10-01",
      items([
        [300, 100],
        [310, 120],
      ]),
      [],
    )!;
    expect(calm.insights).toEqual([{ kind: "allHeadroom", count: 2 }]);
    expect(calm.paydayRange).toBeNull();
    const busy = buildOutlook(
      "2026-10-01",
      items([
        [300, 100],
        [340, 120],
      ]),
      [],
    )!;
    expect(busy.insights).toEqual([{ kind: "noneOver" }]);
  });

  it("keeps capacity per week, and is empty without rows in the window", () => {
    const rows = [
      ...items([[300, 100]], 367),
      ...items(
        [
          [300, 100],
          [300, 100],
        ],
        330,
      ).slice(3),
    ];
    const model = buildOutlook("2026-10-01", rows, [])!;
    expect(model.weeks.map((w) => w.capacityM3)).toEqual([367, 330]);
    expect(buildOutlook("2026-10-01", [], [])).toBeNull();
    expect(buildOutlook("2027-03-01", items(DESIGN), [])).toBeNull();
  });

  it("rounds chart ticks to a readable step", () => {
    expect(chartScale(398)).toEqual({ top: 400, ticks: [0, 100, 200, 300, 400] });
    expect(chartScale(172)).toEqual({ top: 200, ticks: [0, 50, 100, 150, 200] });
    expect(chartScale(0)).toEqual({ top: 1, ticks: [0, 1] });
  });
});
