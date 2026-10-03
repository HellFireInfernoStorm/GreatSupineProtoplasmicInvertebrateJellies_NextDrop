// Synthetic product catalogue per brand (seed-and-demo.md §15.1 item 2). Order weight and volume are computed from
// these unit sizes, so the capacity maths matches the receipt steppers.
import type { Brand, TempRequirement } from "@nextdrop/rules";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { syncRows, type SyncResult } from "./sync";

export interface ProductSpec {
  readonly sku: string;
  readonly name: string;
  readonly brand: Brand;
  readonly tempRequirement: TempRequirement;
  readonly unitLabel: string;
  /** Exact decimal text, at most 6 places. */
  readonly unitWeightKg: string;
  readonly unitVolumeM3: string;
}

const p = (
  sku: string,
  name: string,
  brand: Brand,
  tempRequirement: TempRequirement,
  unitLabel: string,
  unitWeightKg: string,
  unitVolumeM3: string,
): ProductSpec => ({ sku, name, brand, tempRequirement, unitLabel, unitWeightKg, unitVolumeM3 });

export const PRODUCTS: readonly ProductSpec[] = [
  // Fresh, chilled: always its own order (ordering guidance).
  p("FR-MILK-CRATE", "Fresh milk, crate of 12 × 1 L", "Fresh", "chilled", "crate", "13.2", "0.03"),
  p("FR-EGGS-CRATE", "Eggs, crate of 180", "Fresh", "chilled", "crate", "11.5", "0.045"),
  p("FR-YOGHURT-CRATE", "Yoghurt cups, crate of 48", "Fresh", "chilled", "crate", "5.8", "0.02"),
  p("FR-CHEESE-CASE", "Cheese blocks, case of 10", "Fresh", "chilled", "case", "5.2", "0.012"),
  p("FR-CHICKEN-CRATE", "Chicken, chilled crate", "Fresh", "chilled", "crate", "18", "0.04"),
  p("FR-VEG-CRATE", "Vegetables, chilled crate", "Fresh", "chilled", "crate", "15", "0.05"),
  // Fresh, dry goods.
  p("FR-RICE-BAG", "Rice, 25 kg bag", "Fresh", "ambient", "bag", "25", "0.032"),
  p("FR-FLOUR-BAG", "Wheat flour, 10 kg bag", "Fresh", "ambient", "bag", "10", "0.014"),
  p("FR-SUGAR-BAG", "Sugar, 10 kg bag", "Fresh", "ambient", "bag", "10", "0.011"),
  p("FR-TEA-CASE", "Tea, case of 24 × 400 g", "Fresh", "ambient", "case", "10.4", "0.028"),
  p("FR-BISCUIT-CASE", "Biscuits, case of 36", "Fresh", "ambient", "case", "7.2", "0.04"),
  p("FR-NOODLE-CASE", "Noodles, case of 40", "Fresh", "ambient", "case", "3.4", "0.03"),
  p("FR-WATER-CASE", "Bottled water, case of 12 × 1.5 L", "Fresh", "ambient", "case", "18.6", "0.028"),
  // Style.
  p("ST-APPAREL-CARTON", "Apparel, mixed carton", "Style", "ambient", "carton", "8", "0.12"),
  p("ST-SAREE-CARTON", "Sarees, carton of 20", "Style", "ambient", "carton", "9.5", "0.09"),
  p("ST-SHOES-CARTON", "Footwear, carton of 12 pairs", "Style", "ambient", "carton", "11", "0.11"),
  p("ST-ACCESSORY-CARTON", "Accessories, carton", "Style", "ambient", "carton", "4.5", "0.06"),
  // Tech: mostly single large items.
  p("TC-TV-55", "Television, 55 in", "Tech", "ambient", "unit", "24", "0.22"),
  p("TC-FRIDGE", "Refrigerator, double door", "Tech", "ambient", "unit", "68", "0.85"),
  p("TC-WASHER", "Washing machine, front load", "Tech", "ambient", "unit", "72", "0.6"),
  p("TC-AIRCON", "Air conditioner, split unit", "Tech", "ambient", "unit", "45", "0.3"),
  p("TC-LAPTOP-CARTON", "Laptops, carton of 5", "Tech", "ambient", "carton", "14", "0.08"),
];

export function productsFor(brand: Brand, temp: TempRequirement): ProductSpec[] {
  return PRODUCTS.filter((x) => x.brand === brand && x.tempRequirement === temp);
}

export function productBySku(sku: string): ProductSpec {
  const product = PRODUCTS.find((x) => x.sku === sku);
  if (!product) throw new RangeError(`unknown sku ${sku}`);
  return product;
}

export async function seedCatalogue(
  db: PrismaClient,
): Promise<{ productIds: ReadonlyMap<string, string>; result: SyncResult }> {
  const result = await syncRows({
    rows: PRODUCTS.map((x) => ({ ...x })),
    key: (r) => r.sku,
    existing: () => db.product.findMany(),
    create: (rows) => db.product.createMany({ data: rows }),
    update: (id, data) => db.product.update({ where: { id }, data }),
  });
  const productIds = new Map((await db.product.findMany()).map((x) => [x.sku, x.id]));
  return { productIds, result };
}
