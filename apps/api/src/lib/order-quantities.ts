import { Prisma } from "../generated/prisma/client";

type UnitSize = string | number | Prisma.Decimal;
const POSTGRES_INT_MAX = 2147483647;

/** Storage conversion: aggregate exact line snapshots before rounding the final order totals. */
export function aggregateOrderQuantities(
  lines: readonly { qtyOrdered: number; unitWeightKg: UnitSize; unitVolumeM3: UnitSize }[],
): { weightG: number; volumeL: number } {
  let kg = new Prisma.Decimal(0);
  let m3 = new Prisma.Decimal(0);
  for (const line of lines) {
    if (!Number.isSafeInteger(line.qtyOrdered) || line.qtyOrdered < 0 || line.qtyOrdered > POSTGRES_INT_MAX) {
      throw new RangeError("Invalid quantity");
    }
    const weight = new Prisma.Decimal(line.unitWeightKg);
    const volume = new Prisma.Decimal(line.unitVolumeM3);
    if (!weight.isFinite() || !volume.isFinite() || !weight.gt(0) || !volume.gt(0)) {
      throw new RangeError("Invalid unit size");
    }
    kg = kg.add(weight.mul(line.qtyOrdered));
    m3 = m3.add(volume.mul(line.qtyOrdered));
  }
  const weightG = kg.mul(1000).ceil().toNumber();
  const volumeL = m3.mul(1000).ceil().toNumber();
  if (
    !Number.isSafeInteger(weightG) ||
    !Number.isSafeInteger(volumeL) ||
    weightG <= 0 ||
    volumeL <= 0 ||
    weightG > POSTGRES_INT_MAX ||
    volumeL > POSTGRES_INT_MAX
  ) {
    throw new RangeError("Invalid order totals");
  }
  return { weightG, volumeL };
}
