// zod contracts shared by web and API: DTOs, event envelope and catalogue, error codes, feed kinds (spec/events).
import { z } from "zod";

/** Event payload schema version. Bump it and add an upcaster when a payload changes. */
export const SCHEMA_VERSION = 1;

export const schemaVersion = z.number().int().min(1).max(SCHEMA_VERSION);
