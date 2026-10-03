import { apiRoutes, apiSchemas, type ApiDto, type ClientEvent, type FieldSnapshot } from "@nextdrop/contracts";
import { API_MOCK, ApiRequestError, callApi, notifySessionExpired } from "../lib/api";
import { currentSession } from "../lib/session";
import type { QueuedBlob } from "./database";

export interface SyncTransport {
  snapshot(date: string): Promise<FieldSnapshot>;
  changes(after: string, limit: number): Promise<ApiDto<"changesResponse">>;
  push(deviceId: string, events: ClientEvent[]): Promise<ApiDto<"syncEventsResponse">>;
  upload(blob: QueuedBlob): Promise<void>;
}
export const syncTransport: SyncTransport = {
  snapshot: (date) => callApi("snapshot", { query: { date }, signal: AbortSignal.timeout(20000) }),
  changes: (after, limit) => callApi("changes", { query: { after, limit }, signal: AbortSignal.timeout(20000) }),
  push: (deviceId, events) => callApi("syncEvents", { body: { deviceId, events }, signal: AbortSignal.timeout(20000) }),
  upload: async (blob) => {
    const bytes = new Uint8Array(await blob.bytes.arrayBuffer());
    apiSchemas.blobBody.parse(bytes);
    if (API_MOCK) return;
    const response = await fetch(apiRoutes.uploadBlob.path.replace(":id", encodeURIComponent(blob.clientBlobId)), {
      signal: AbortSignal.timeout(20000),
      method: "PUT",
      credentials: "same-origin",
      body: bytes,
      headers: { "content-type": blob.bytes.type, "x-nextdrop-csrf": currentSession()?.csrfToken ?? "1" },
    });
    if (response.status === 401) notifySessionExpired();
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = apiSchemas.apiError.safeParse(body);

      throw new ApiRequestError("http", response.status, parsed.success ? parsed.data : null, "Blob upload failed");
    }
    const parsed = apiSchemas.blobResponse.safeParse(body);
    if (!parsed.success) throw new ApiRequestError("invalid", response.status, null, "Invalid blob acknowledgement");
    const result = parsed.data;
    if (result.clientBlobId !== blob.clientBlobId) throw new Error("Uncorrelated blob acknowledgement");
  },
};
