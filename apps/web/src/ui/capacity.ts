/** Invalid measurements remain unavailable; clamp only the rendered fraction. */
export function capacityRatio(used: number, capacity: number | null | undefined): number | null {
  if (!Number.isFinite(used) || used < 0 || capacity == null || !Number.isFinite(capacity) || capacity <= 0)
    return null;
  return Math.min(1, used / capacity);
}
