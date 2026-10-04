import type { ApiDto } from "@nextdrop/contracts";
import { ApiRequestError, type ApiResponse } from "../../lib/api";

interface Ports {
  save: (data: ApiDto<"draftData">) => Promise<ApiDto<"draft"> | null>;
  publish: (revision: number) => Promise<ApiResponse<"publish">>;
}
export function isUncertainPublishError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.kind === "network" ||
      (error.status ?? 0) >= 500 ||
      (error.kind === "invalid" && error.status !== null && error.status >= 200 && error.status < 300))
  );
}
/** One scope's save/publish boundary. A lost response retries the same idempotent revision. */
export class PublishSession {
  private snapshot: { busy: boolean; uncertain: boolean; error: unknown; response: ApiResponse<"publish"> | null } = {
    busy: false,
    uncertain: false,
    error: null,
    response: null,
  };
  private listeners = new Set<() => void>();
  private saved: { signature: string; revision: number } | null = null;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  reset() {
    if (this.snapshot.busy || this.snapshot.uncertain) return;
    this.saved = null;
    this.update({ error: null, response: null });
  }
  async run(data: ApiDto<"draftData">, ports: Ports): Promise<ApiResponse<"publish"> | null> {
    if (this.snapshot.busy) return null;
    this.update({ busy: true, error: null });
    try {
      const signature = JSON.stringify(data);
      if (!this.snapshot.uncertain && this.saved?.signature !== signature) {
        const draft = await ports.save(data);
        if (!draft) return null;
        this.saved = { signature, revision: draft.revision };
      }
      try {
        const response = await ports.publish(this.saved!.revision);
        this.update({ uncertain: false, response });
        return response;
      } catch (error) {
        this.update({ uncertain: isUncertainPublishError(error), error });
        throw error;
      }
    } finally {
      this.update({ busy: false });
    }
  }
}
