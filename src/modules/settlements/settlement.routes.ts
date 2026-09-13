import type { FastifyInstance, FastifyReply } from 'fastify';
import type { UserRole } from '../auth/auth.types';
import { settlementPeriod, periodFromInputs, type SettlementPeriod } from './settlement.policy';
import { DISPUTE_SUBJECTS, type DisputeSubject } from './dispute.policy';
import type { SettlementService } from './settlement.service';

export interface SettlementModuleDeps {
  settlements: SettlementService;
}

const OPS: UserRole[] = ['ADMIN', 'DISPATCHER'];

/** The pay period a request is asking about. */
type PeriodQuery = { period?: string; from?: string; to?: string };

const periodQuerySchema = {
  type: 'object',
  properties: {
    period: { type: 'string', enum: ['current', 'last', 'ytd'] },
    from: { type: 'string', maxLength: 10 },
    to: { type: 'string', maxLength: 10 },
  },
} as const;

/**
 * Defaults to the week the driver is standing in — the figure they actually ask
 * about. Explicit `from`/`to` win, then `period`, and the week is resolved in
 * the driver's home-terminal timezone so a Sunday-night delivery lands in the
 * week that is ending rather than the next one.
 */
function resolvePeriod(query: PeriodQuery, tz: string): SettlementPeriod {
  if (query.from && query.to) {
    const explicit = periodFromInputs(query.from, query.to, tz);
    if (explicit) return explicit;
  }
  if (query.period === 'last') return settlementPeriod(new Date(), tz, 1);
  return settlementPeriod(new Date(), tz, 0);
}

function isOps(request: { user: { roles: UserRole[] } }): boolean {
  return (request.user.roles as string[]).some((role) => role === 'ADMIN' || role === 'DISPATCHER');
}

function sendPdf(reply: FastifyReply, fileName: string, pdf: Buffer): FastifyReply {
  return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `inline; filename="${fileName}"`)
    .header('X-Content-Type-Options', 'nosniff')
    .send(pdf);
}

const raiseDisputeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['loadId', 'message'],
  properties: {
    loadId: { type: 'string', maxLength: 64 },
    subject: { type: 'string', enum: DISPUTE_SUBJECTS as unknown as string[] },
    message: { type: 'string', maxLength: 1000 },
    /** Which statement the line came from; defaults to the current week. */
    period: { type: 'string', enum: ['current', 'last'] },
  },
} as const;

const decideDisputeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'resolution'],
  properties: {
    status: { type: 'string', enum: ['RESOLVED', 'DECLINED'] },
    resolution: { type: 'string', maxLength: 1000 },
  },
} as const;

const signatureSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['signerName', 'data'],
  properties: {
    signerName: { type: 'string', maxLength: 120 },
    role: { type: 'string', enum: ['DRIVER', 'CARRIER'] },
    /** Base64 JPEG/PNG drawn on the pad. */
    data: { type: 'string' },
    period: { type: 'string', enum: ['current', 'last'] },
  },
} as const;

export function registerSettlementRoutes(app: FastifyInstance, deps: SettlementModuleDeps): void {
  // -------------------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------------------

  // A driver's own statement. Registered before the fleet route so `/me` can
  // never be read as a driver id.
  app.get<{ Querystring: PeriodQuery }>(
    '/api/settlements/me',
    {
      schema: { querystring: periodQuerySchema },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const user = request.user;
      if (!user.driverId) return reply.send(null);
      const tz = await deps.settlements.driverTimezone(user.tenantId, user.driverId);
      return reply.send(await deps.settlements.forSelf(user.tenantId, user.driverId, resolvePeriod(request.query, tz)));
    },
  );

  app.get<{ Querystring: PeriodQuery }>(
    '/api/settlements',
    {
      schema: { querystring: periodQuerySchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      const tz = await deps.settlements.tenantTimezone(request.user.tenantId);
      return reply.send(await deps.settlements.overview(request.user.tenantId, resolvePeriod(request.query, tz)));
    },
  );

  app.get<{ Params: { driverId: string }; Querystring: PeriodQuery }>(
    '/api/settlements/drivers/:driverId',
    {
      schema: { querystring: periodQuerySchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      const tz = await deps.settlements.driverTimezone(request.user.tenantId, request.params.driverId);
      return reply.send(
        await deps.settlements.forDriver(request.user.tenantId, request.params.driverId, resolvePeriod(request.query, tz)),
      );
    },
  );

  // Drivers may pull their own statement; ops may pull anyone's. Both go through
  // the service, which scopes every lookup by tenant.
  app.get<{ Querystring: PeriodQuery }>(
    '/api/settlements/me/statement.pdf',
    {
      schema: { querystring: periodQuerySchema },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      if (!request.user.driverId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
      }
      const tz = await deps.settlements.driverTimezone(request.user.tenantId, request.user.driverId);
      const file = await deps.settlements.statementPdf(
        request.user.tenantId,
        request.user.driverId,
        resolvePeriod(request.query, tz),
      );
      return sendPdf(reply, file.fileName, file.pdf);
    },
  );

  app.get<{ Params: { driverId: string }; Querystring: PeriodQuery }>(
    '/api/settlements/drivers/:driverId/statement.pdf',
    {
      schema: { querystring: periodQuerySchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      const tz = await deps.settlements.driverTimezone(request.user.tenantId, request.params.driverId);
      const file = await deps.settlements.statementPdf(
        request.user.tenantId,
        request.params.driverId,
        resolvePeriod(request.query, tz),
      );
      return sendPdf(reply, file.fileName, file.pdf);
    },
  );

  // -------------------------------------------------------------------------
  // Signatures
  //
  // A driver signs their own statement; the office signs one on the driver's
  // behalf at the yard. A driver may not sign for somebody else, which is the
  // whole point of capturing it here rather than filing a paper sheet.
  // -------------------------------------------------------------------------

  app.post<{
    Params: { driverId: string };
    Body: { signerName: string; data: string; role?: string; period?: string };
  }>(
    '/api/settlements/drivers/:driverId/signature',
    {
      schema: { body: signatureSchema },
      bodyLimit: 4 * 1024 * 1024,
      preHandler: async (request, reply) => {
        await app.authenticate(request, reply);
        if (reply.sent) return;
        if (!isOps(request) && !request.user.driverId) {
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
        }
        if (!isOps(request) && request.user.driverId !== request.params.driverId) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'you can only sign your own statement' });
        }
      },
    },
    async (request, reply) => {
      const tz = await deps.settlements.driverTimezone(request.user.tenantId, request.params.driverId);
      const period = resolvePeriod({ period: request.body.period }, tz);
      const row = await deps.settlements.captureSignature({
        tenantId: request.user.tenantId,
        driverId: request.params.driverId,
        role: request.body.role ?? 'DRIVER',
        signerName: request.body.signerName,
        periodFrom: period.from,
        periodTo: period.to,
        periodLabel: period.label,
        dataBase64: request.body.data,
        capturedById: request.user.sub,
      });
      return reply.code(201).send(row);
    },
  );

  app.get<{ Params: { driverId: string }; Querystring: PeriodQuery }>(
    '/api/settlements/drivers/:driverId/signatures',
    {
      schema: { querystring: periodQuerySchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      const tz = await deps.settlements.driverTimezone(request.user.tenantId, request.params.driverId);
      const hasPeriod = Boolean(request.query.from && request.query.to) || Boolean(request.query.period);
      return reply.send(
        await deps.settlements.listSignatures(
          request.user.tenantId,
          request.params.driverId,
          hasPeriod ? resolvePeriod(request.query, tz) : undefined,
        ),
      );
    },
  );

  // -------------------------------------------------------------------------
  // Pay queries
  //
  // The driver raises one against a line they can actually see on their own
  // statement; the office reads them with the load and the arithmetic attached.
  // -------------------------------------------------------------------------

  app.post<{
    Body: { loadId: string; subject?: DisputeSubject; message: string; period?: string };
  }>(
    '/api/settlements/disputes',
    {
      schema: { body: raiseDisputeSchema },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      if (!request.user.driverId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
      }
      const tz = await deps.settlements.driverTimezone(request.user.tenantId, request.user.driverId);
      const row = await deps.settlements.raiseDispute({
        tenantId: request.user.tenantId,
        driverId: request.user.driverId,
        loadId: request.body.loadId,
        subject: request.body.subject ?? 'LINE',
        message: request.body.message,
        period: resolvePeriod({ period: request.body.period }, tz),
      });
      return reply.code(201).send(row);
    },
  );

  app.get(
    '/api/settlements/disputes/mine',
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.user.driverId) return reply.send([]);
      return reply.send(await deps.settlements.listDisputesForDriver(request.user.tenantId, request.user.driverId));
    },
  );

  app.get<{ Querystring: { status?: string } }>(
    '/api/settlements/disputes',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['OPEN', 'RESOLVED', 'DECLINED'] } },
        },
      },
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) =>
      reply.send(await deps.settlements.listDisputes(request.user.tenantId, { status: request.query.status ?? null })),
  );

  app.patch<{ Params: { id: string }; Body: { status: 'RESOLVED' | 'DECLINED'; resolution: string } }>(
    '/api/settlements/disputes/:id',
    {
      schema: { body: decideDisputeSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) =>
      reply.send(
        await deps.settlements.decideDispute({
          tenantId: request.user.tenantId,
          id: request.params.id,
          decision: request.body.status,
          resolution: request.body.resolution,
          actorId: request.user.sub,
        }),
      ),
  );
}
