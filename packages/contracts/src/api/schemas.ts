import type { z } from "zod";
import { commonSchemas } from "./common";
import { resourceSchemas } from "./resources";
import { planningResourceSchemas } from "./planning-resources";
import { authSchemas } from "./auth";
import { referenceSchemas } from "./reference";
import { storeSchemas } from "./store";
import { dispatchSchemas } from "./dispatch";
import { fieldSchemas } from "./field";
import { feedSchemas } from "./feed";
import { notificationSchemas } from "./notifications";
import { demoSchemas } from "./demo";
import { opsSchemas } from "./ops";

export const apiSchemas = {
  ...commonSchemas,
  ...resourceSchemas,
  ...planningResourceSchemas,
  ...authSchemas,
  ...referenceSchemas,
  ...storeSchemas,
  ...dispatchSchemas,
  ...fieldSchemas,
  ...feedSchemas,
  ...notificationSchemas,
  ...demoSchemas,
  ...opsSchemas,
} as const;
export type ApiSchemaName = keyof typeof apiSchemas;
export type ApiDto<K extends ApiSchemaName> = z.output<(typeof apiSchemas)[K]>;
export type ApiDtoInput<K extends ApiSchemaName> = z.input<(typeof apiSchemas)[K]>;
