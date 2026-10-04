import type { ApiValidationResult } from "@nextdrop/contracts";
import { ApiRequestError } from "../../lib/api";
import { emptyDraft, type Draft, type DraftData } from "./planning";

interface Snapshot {
  generation: number;
  draft: Draft | null;
  data: DraftData;
  candidate: DraftData | null;
  busy: boolean;
  error: unknown;
  validation: ApiValidationResult | null;
}
interface Ports {
  validate: (data: DraftData) => Promise<ApiValidationResult>;
  save: (data: DraftData, revision: number) => Promise<Draft>;
}
/** One instance per depot/date. Old responses can only update their own instance. */
export class DraftSession {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  constructor(draft: Draft | null, ids: readonly string[]) {
    this.snapshot = {
      generation: 0,
      draft,
      data: draft?.data ?? emptyDraft(ids),
      candidate: null,
      busy: false,
      error: null,
      validation: null,
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  replace(draft: Draft | null, ids: readonly string[]) {
    if (this.snapshot.busy) return;
    this.update({
      generation: this.snapshot.generation + 1,
      draft,
      data: draft?.data ?? emptyDraft(ids),
      candidate: null,
      error: null,
      validation: null,
    });
  }
  async propose(port: (revision: number) => Promise<Draft>): Promise<boolean> {
    if (this.snapshot.busy) return false;
    this.update({ busy: true, error: null, validation: null });
    try {
      const draft = await port(this.snapshot.draft?.revision ?? 0);
      this.update({ draft, data: draft.data, candidate: null });
      return true;
    } catch (error) {
      this.update({ error });
      return false;
    } finally {
      this.update({ busy: false });
    }
  }
  async persist(candidate: DraftData, ports: Ports): Promise<boolean> {
    if (this.snapshot.busy) return false;
    const revision = this.snapshot.draft?.revision ?? 0;
    this.update({ busy: true, candidate, error: null, validation: null });
    try {
      const validation = await ports.validate(candidate);
      this.update({ validation });
      if (!validation.ok) return false;
      const draft = await ports.save(candidate, revision);
      this.update({ draft, data: draft.data, candidate: null });
      return true;
    } catch (error) {
      this.update({ error, validation: error instanceof ApiRequestError ? error.validation : null });
      return false;
    } finally {
      this.update({ busy: false });
    }
  }
}
