import { afterEach, expect, it, vi } from "vitest";
import { compressPhoto } from "./blobs";

afterEach(() => vi.unstubAllGlobals());

it("bounds dimensions and shrinks high-entropy photos until the compression target is met", async () => {
  const close = vi.fn();
  const draws: number[][] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (_image: unknown, _x: number, _y: number, width: number, height: number) => {
        draws.push([width, height]);
      },
    }),
    toBlob: (callback: (value: Blob) => void) =>
      callback(new Blob([new Uint8Array(draws.length === 1 ? 400 * 1024 : 180 * 1024)], { type: "image/jpeg" })),
  };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 4000, height: 2000, close })),
  );
  vi.stubGlobal("document", { createElement: () => canvas });
  const result = await compressPhoto(new Blob(["source image"]));
  expect(draws[0]).toEqual([1280, 640]);
  expect(draws.at(-1)![0]).toBeLessThan(1280);
  expect(result.size).toBeLessThanOrEqual(200 * 1024);
  expect(result.type).toBe("image/jpeg");
  expect(close).toHaveBeenCalledOnce();
});

it("closes decoded images if canvas compression is unavailable", async () => {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 100, height: 100, close })),
  );
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
  await expect(compressPhoto(new Blob(["image"]))).rejects.toThrow("Image compression unavailable");
  expect(close).toHaveBeenCalledOnce();
});
