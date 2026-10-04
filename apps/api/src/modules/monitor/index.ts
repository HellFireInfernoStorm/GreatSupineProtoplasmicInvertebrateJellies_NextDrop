// Delivery progress (D4): the live run monitor, the exceptions inbox and dispute resolution (ADR 0041).
import {
  ackResponseSchema,
  dayQuerySchema,
  outlookQuerySchema,
  outlookResponseSchema,
  exceptionsResponseSchema,
  idParamsSchema,
  mutationHeadersSchema,
  resolveIssueRequestSchema,
  runsResponseSchema,
} from "@nextdrop/contracts";
import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { forbidden, notFound } from "../../lib/errors";
import { createNotifier } from "../notifications";
import { createCalendarSource, type CalendarSource } from "../orders";
import type { ResourceResolver } from "../policy";
import { listExceptions } from "./exceptions";
import { createIssues, type Issues } from "./issues";
import { listOutlook } from "./outlook";
import { listRuns } from "./runs";

export { runState, vehicleSignals, type RunSignal } from "./runs";

/** The `?depot=` a day view asks for; the policy checks it against the dispatcher's depots. */
const depotQuery: ResourceResolver = (request) => ({
  kind: "depot",
  depot: (request.query as { depot: string }).depot,
});

/** An issue is its ISSUE_REPORTED event; its depot is the order's outlet depot. */
function issueResource(prisma: PrismaClient): ResourceResolver {
  return async (request) => {
    const { id } = request.params as { id: string };
    const issue = await prisma.orderEvent.findUnique({
      where: { id },
      select: { type: true, order: { select: { outlet: { select: { depot: true } } } } },
    });
    if (!issue || issue.type !== "ISSUE_REPORTED" || !issue.order) throw notFound();
    return { kind: "depot", depot: issue.order.outlet.depot };
  };
}

interface MonitorDependencies {
  prisma: PrismaClient;
  now: () => Date;
  calendar: CalendarSource;
  issues: Issues;
}

const monitorRoutes: FastifyPluginAsyncZod<MonitorDependencies> = async (app, deps) => {
  const { prisma } = deps;

  app.get(
    "/api/dispatch/outlook",
    {
      schema: { querystring: outlookQuerySchema, response: { 200: outlookResponseSchema } },
      config: { policy: { action: "outlook", resourceResolver: depotQuery } },
    },
    async (request) => {
      const { depot, from, weeks } = request.query;
      const items = await listOutlook(prisma, await deps.calendar.get(), depot, from, weeks);
      return { items, serverTime: deps.now().toISOString() };
    },
  );

  app.get(
    "/api/dispatch/runs",
    {
      schema: { querystring: dayQuerySchema, response: { 200: runsResponseSchema } },
      config: { policy: { action: "runs", resourceResolver: depotQuery } },
    },
    async (request) => {
      const now = deps.now();
      return { items: await listRuns(prisma, request.query.depot, now), serverTime: now.toISOString() };
    },
  );

  app.get(
    "/api/dispatch/exceptions",
    {
      schema: { querystring: dayQuerySchema, response: { 200: exceptionsResponseSchema } },
      config: { policy: { action: "exceptions", resourceResolver: depotQuery } },
    },
    async (request) => ({ items: await listExceptions(prisma, request.query.depot, deps.now()) }),
  );

  app.post(
    "/api/dispatch/issues/:id/resolve",
    {
      schema: {
        params: idParamsSchema,
        headers: mutationHeadersSchema,
        body: resolveIssueRequestSchema,
        response: { 200: ackResponseSchema },
      },
      config: { policy: { action: "resolveIssue", resourceResolver: issueResource(prisma) } },
    },
    async (request) => {
      const actor = request.actor;
      if (actor?.role !== "DISPATCHER") throw forbidden();
      return deps.issues.resolve(actor, request.params.id, request.body);
    },
  );
};

export async function registerMonitor(app: FastifyInstance, deps: { prisma: PrismaClient | null; now: () => Date }) {
  if (!deps.prisma) return;
  const calendar = createCalendarSource(deps.prisma);
  const issues = createIssues({ prisma: deps.prisma, now: deps.now, calendar, notifier: createNotifier(deps.now) });
  await app.register(monitorRoutes, { prisma: deps.prisma, now: deps.now, calendar, issues });
}
