import type { ApiSchemaName, ApiDtoInput } from "./schemas";
import { webRoutes } from "./routes/web";
import { dispatchRoutes } from "./routes/dispatch";
import { fieldSupportRoutes } from "./routes/field-support";
export * from "./routes/definitions";
/** Registry references allow API registration and role-matrix tests to use one inventory. */
export const apiRoutes = { ...webRoutes, ...dispatchRoutes, ...fieldSupportRoutes } as const;
export type ApiRouteName = keyof typeof apiRoutes;
export type ApiRouteFixtures = {
  [K in ApiRouteName]: {
    request: {
      [P in keyof (typeof apiRoutes)[K]["request"]]: (typeof apiRoutes)[K]["request"][P] extends ApiSchemaName
        ? ApiDtoInput<(typeof apiRoutes)[K]["request"][P]>
        : never;
    };
    responses: {
      [S in keyof (typeof apiRoutes)[K]["responses"]]: (typeof apiRoutes)[K]["responses"][S] extends ApiSchemaName
        ? ApiDtoInput<(typeof apiRoutes)[K]["responses"][S]>
        : never;
    };
  };
};
