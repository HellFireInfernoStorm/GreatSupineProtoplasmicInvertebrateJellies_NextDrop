import type { RulesConfig, ValidationResult, Violation } from "@nextdrop/rules";
import { expectTypeOf, it } from "vitest";
import {
  type clientEventSchema,
  type fieldSnapshotSchema,
  type loginRequestSchema,
  type syncEventResultSchema,
  validationResultSchema,
  type violationSchema,
  type rulesConfigSchema,
  type ClientEvent,
  type ApiDto,
  type ApiDtoInput,
  type SyncResultStatus,
  type SyncEventResult,
} from "./index";

it("keeps producer validation and config types assignable without casts", () => {
  expectTypeOf(validationResultSchema.parse({ ok: true, violations: [] })).toExtend<ValidationResult>();
  expectTypeOf<ValidationResult>().toExtend<ApiDto<"validationResult">>();
  expectTypeOf<Violation>().toExtend<ReturnType<typeof violationSchema.parse>>();
  expectTypeOf<RulesConfig>().toExtend<ReturnType<typeof rulesConfigSchema.parse>>();
  expectTypeOf<ReturnType<typeof rulesConfigSchema.parse>>().toExtend<RulesConfig>();
});

it("preserves discriminated variants in public inferred types", () => {
  expectTypeOf<SyncEventResult["status"]>().toEqualTypeOf<SyncResultStatus>();
  expectTypeOf<ReturnType<typeof clientEventSchema.parse>>().toEqualTypeOf<ClientEvent>();
  expectTypeOf<ApiDtoInput<"clientEvent">>().toEqualTypeOf<ClientEvent>();
  type Loaded = Extract<ClientEvent, { type: "LOAD_CONFIRMED" }>;
  expectTypeOf<Loaded["payload"]>().toEqualTypeOf<{ lines: { lineId: string; qtyLoaded: number }[] }>();
  // @ts-expect-error LOAD_CONFIRMED cannot have a TRIP_READY payload.
  const wrongPayload: Loaded["payload"] = { tripId: "trip-1" };
  void wrongPayload;
  type Driver = Extract<ReturnType<typeof loginRequestSchema.parse>, { role: "DRIVER" }>;
  // @ts-expect-error Driver login requires a PIN, not a password.
  const wrongLogin: Driver = { role: "DRIVER", loginId: "DRV001", password: "secret", deviceId: "device-1" };
  void wrongLogin;
  type Rejected = Extract<ReturnType<typeof syncEventResultSchema.parse>, { status: "REJECTED" }>;
  // @ts-expect-error Rejected results require a code.
  const wrongResult: Rejected = { status: "REJECTED", clientEventId: "event-1", receivedAt: "2026-10-03T00:00:00Z" };
  void wrongResult;
  type DriverSnapshot = Extract<ReturnType<typeof fieldSnapshotSchema.parse>, { role: "DRIVER" }>;
  expectTypeOf<DriverSnapshot["scope"]>().toHaveProperty("vehicle");
});
