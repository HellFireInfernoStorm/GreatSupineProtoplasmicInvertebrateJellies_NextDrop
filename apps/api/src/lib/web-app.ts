import { existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import type { NotFoundFallback } from "./errors";

/** The app shell and the service worker must always be refetched, or clients keep an old build (deployment.md). */
const NO_STORE = new Set(["index.html", "sw.js"]);

/** Cache-Control for a file served from the built PWA, by its path relative to the build root. */
export function cacheControlFor(path: string): string {
  if (NO_STORE.has(path)) return "no-store";
  // Vite fingerprints everything under assets/, so a changed file always gets a new name.
  if (path.startsWith("assets/")) return "public, max-age=31536000, immutable";
  return "no-cache";
}

/**
 * Serves the built PWA from the API's origin (`WEB_DIST_DIR` in the container). Files are served from the not-found
 * path rather than as routes, because every route must declare an API policy (ADR 0028). A GET outside `/api` gets
 * the file if it exists, otherwise `index.html` so client-side routes survive a reload; `/api` keeps the JSON 404.
 */
export async function registerWebApp(app: FastifyInstance, root: string): Promise<NotFoundFallback> {
  const base = resolve(root);
  if (!existsSync(resolve(base, "index.html"))) throw new Error(`WEB_DIST_DIR has no index.html: ${root}`);
  // serve: false registers no routes; it only adds reply.sendFile for the fallback below.
  await app.register(fastifyStatic, { root: base, serve: false });

  const fileIn = (urlPath: string): string | undefined => {
    let rel: string;
    try {
      rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
    } catch {
      return undefined;
    }
    const full = resolve(base, rel);
    if (!rel || !full.startsWith(base + sep) || !existsSync(full) || !statSync(full).isFile()) return undefined;
    return full
      .slice(base.length + 1)
      .split(sep)
      .join("/");
  };

  return (request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD") return undefined;
    const urlPath = request.url.split("?")[0]!;
    if (urlPath === "/api" || urlPath.startsWith("/api/")) return undefined;
    const file = fileIn(urlPath) ?? "index.html";
    return reply.code(200).header("cache-control", cacheControlFor(file)).sendFile(file, { cacheControl: false });
  };
}
