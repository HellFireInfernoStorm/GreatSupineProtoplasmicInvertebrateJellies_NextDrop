import type { ApiRouteFixtures } from "./routes";
import { apiFixtures } from "./fixtures";
import { resourceFixtures as r } from "./resource-fixtures";
const error = apiFixtures.apiError;
const reasons = apiFixtures.reasonsResponse;
/** Every route has a populated fixture for each declared request part and response status. */
const f = apiFixtures;
const headers = f.mutationHeaders;
const params = f.idParams;
const day = { params: f.dateParams, query: f.dayQuery };
const unauthorized = { ...error, code: "INVALID_CREDENTIALS", message_key: "errors.invalid_credentials" } as const;
const rateLimited = { ...error, code: "RATE_LIMITED", message_key: "errors.rate_limited" } as const;
const revisionConflict = { ...error, code: "REVISION_CONFLICT", message_key: "errors.revision_conflict" } as const;
const tooLarge = { ...error, code: "PAYLOAD_TOO_LARGE", message_key: "errors.payload_too_large" } as const;
export const apiRouteFixtures = {
  login: {
    request: { headers, body: f.loginRequest },
    responses: { 200: f.sessionResponse, 401: unauthorized, 429: rateLimited },
  },
  logout: { request: { headers }, responses: { 200: f.ackResponse } },
  me: { request: {}, responses: { 200: f.sessionResponse } },
  reauth: {
    request: { headers, body: f.reauthRequest },
    responses: {
      200: {
        ...f.sessionResponse,
        user: { role: "LOADER", id: "loader-1", displayName: "Mock loader", locale: "en", depot: "Peliyagoda" },
      },
      401: unauthorized,
      429: rateLimited,
    },
  },
  outlets: { request: { query: f.referenceQuery }, responses: { 200: f.outletsResponse } },
  vehicles: { request: { query: f.referenceQuery }, responses: { 200: f.vehiclesResponse } },
  products: { request: { query: f.referenceQuery }, responses: { 200: f.productsResponse } },
  calendar: { request: { query: f.calendarQuery }, responses: { 200: f.calendarResponse } },
  reasons: { request: {}, responses: { 200: reasons } },
  storeCutoff: { request: { query: f.dateQuery }, responses: { 200: f.cutoffResponse } },
  storeDeliveries: { request: { query: f.dateQuery }, responses: { 200: f.deliveriesResponse } },
  createOrder: {
    request: { headers: f.orderCreateHeaders, body: f.createOrderRequest },
    responses: { 201: { ...r.order, status: "ORDERED", assignment: null }, 422: error },
  },
  storeOrders: { request: { query: f.orderListQuery }, responses: { 200: f.ordersResponse } },
  storeOrder: {
    request: { params },
    responses: { 200: f.orderDetail, 404: { ...error, code: "NOT_FOUND", message_key: "errors.not_found" } },
  },
  cancelOrder: {
    request: { params, headers, body: f.cancelOrderRequest },
    responses: { 200: { ...r.order, status: "CANCELLED", assignment: null }, 409: error },
  },
  receipt: {
    request: { params, headers, body: f.receiptRequest },
    responses: {
      200: { ...r.order, status: "RECEIVED", lines: [{ ...r.orderLine, qtyDelivered: 2, qtyReceived: 2 }] },
      422: error,
    },
  },
  reportIssue: {
    request: { params, headers, body: f.reportIssueRequest },
    responses: { 201: { ...f.issueCreatedResponse, order: { ...r.order, status: "DISPUTED" } } },
  },
  storeNotifications: { request: { query: f.notificationsQuery }, responses: { 200: f.notificationsResponse } },
  storeNotificationsRead: {
    request: { headers, body: f.readNotificationsRequest },
    responses: { 200: f.readNotificationsResponse },
  },
  dispatchDay: { request: day, responses: { 200: f.dayResponse } },
  propose: {
    request: { ...day, headers, body: f.proposeRequest },
    responses: { 200: f.proposeResponse, 409: revisionConflict },
  },
  getDraft: { request: day, responses: { 200: f.draftResponse } },
  saveDraft: {
    request: { ...day, headers, body: f.saveDraftRequest },
    responses: { 200: f.draftResponse, 409: revisionConflict, 422: f.validationErrorResponse },
  },
  validate: {
    request: { ...day, headers, body: f.validateRequest },
    responses: { 200: { ok: true, violations: [] }, 422: f.validationErrorResponse },
  },
  publish: {
    request: { ...day, headers, body: f.publishRequest },
    responses: {
      200: f.publishResponse,
      409: { ...error, code: "STOP_LOCKED", message_key: "errors.stop_locked" },
      422: f.validationErrorResponse,
    },
  },
  versions: { request: day, responses: { 200: f.versionsResponse } },
  runs: { request: { query: f.dayQuery }, responses: { 200: f.runsResponse } },
  exceptions: { request: { query: f.dayQuery }, responses: { 200: f.exceptionsResponse } },
  resolveConflict: {
    request: { params, headers, body: f.resolveConflictRequest },
    responses: { 200: f.ackResponse, 409: error },
  },
  resolveIssue: {
    request: { params, headers, body: f.resolveIssueRequest },
    responses: { 200: f.ackResponse, 409: error },
  },
  getFleet: { request: { query: f.dateQuery }, responses: { 200: f.fleetResponse } },
  resolveShort: {
    request: { params: f.orderLineParams, headers, body: f.resolveShortRequest },
    responses: {
      200: f.resolveShortResponse,
      404: { ...error, code: "NOT_FOUND", message_key: "errors.not_found" },
      409: { ...error, code: "ILLEGAL_TRANSITION", message_key: "errors.illegal_transition" },
    },
  },
  requestReversal: {
    request: { params: { id: f.order.id }, headers, body: f.requestReversalRequest },
    responses: {
      200: f.requestReversalResponse,
      404: { ...error, code: "NOT_FOUND", message_key: "errors.not_found" },
      409: { ...error, code: "ILLEGAL_TRANSITION", message_key: "errors.illegal_transition" },
    },
  },
  updateFleet: { request: { headers, body: f.updateFleetRequest }, responses: { 200: f.fleetResponse } },
  outlook: { request: { query: f.outlookQuery }, responses: { 200: f.outlookResponse } },
  outletHistory: { request: { params, query: f.listQuery }, responses: { 200: f.orderHistoryResponse } },
  snapshot: { request: { query: f.dateQuery }, responses: { 200: f.fieldSnapshot } },
  syncEvents: {
    request: { headers, body: f.syncEventsRequest },
    responses: { 200: f.syncEventsResponse, 413: tooLarge },
  },
  blob: {
    request: { params },
    responses: { 200: f.blobBody, 404: { ...error, code: "NOT_FOUND", message_key: "errors.not_found" } },
  },
  uploadBlob: {
    request: { params, headers: f.blobHeaders, body: f.blobBody },
    responses: { 200: f.blobResponse, 413: tooLarge },
  },
  heartbeat: { request: { headers, body: f.heartbeatRequest }, responses: { 200: f.heartbeatResponse } },
  fieldConflicts: {
    request: { headers, body: f.fieldConflictsRequest },
    responses: { 200: f.fieldConflictsResponse },
  },
  changes: { request: { query: f.changesQuery }, responses: { 200: f.changesResponse } },
  stream: { request: { query: f.streamQuery }, responses: { 200: f.streamHint } },
  notifications: { request: { query: f.notificationsQuery }, responses: { 200: f.notificationsResponse } },
  notificationsRead: {
    request: { headers, body: f.readNotificationsRequest },
    responses: { 200: f.readNotificationsResponse },
  },
  demoState: { request: {}, responses: { 200: f.demoState } },
  demoClock: { request: { headers, body: f.demoClockRequest }, responses: { 200: f.demoState } },
  demoReset: {
    request: { headers, body: f.demoResetRequest },
    responses: { 200: { ...f.demoState, preset: "plan-published", resetEpoch: 2 } },
  },
  demoTick: { request: { headers }, responses: { 200: f.demoTickResponse } },
  health: { request: {}, responses: { 200: f.healthResponse } },
  ready: { request: {}, responses: { 200: f.readyResponse, 503: f.notReadyResponse } },
} satisfies ApiRouteFixtures;
