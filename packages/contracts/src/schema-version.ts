import { z } from "zod";

/** Event payload schema version. Bump it and add an upcaster when a payload changes. */
export const SCHEMA_VERSION = 2;

export const schemaVersion = z.number().int().min(1).max(SCHEMA_VERSION);
