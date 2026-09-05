import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { fastifyJwt as registerJwt } from '@fastify/jwt';
import type { Logger } from 'pino';

import type { AppEnv } from './config/env';
import { loadEnv } from './config/env';
import { buildLogger } from './logger/logger';
import { getPrisma, type PrismaClient } from './db/prisma';
import { EventBus } from './events/event-bus';
import {
  EVENTS,
  type FuelTransactionImportedPayload,
  type HosLogUpdatedPayload,
  type IftaQuarterComputeRequestedPayload,
  type LoadDispatchedPayload,
  type LoadImportedPayload,
  type LoadStatusChangedPayload,
  type RouteSegmentBatchCompletedPayload,
} from './events/domain-events';

import { authGuardPlugin } from './guards/auth.plugin';
import { AppError } from './utils/errors';

import { AuthService } from './modules/auth/auth.service';
import { PrismaAuthRepository } from './modules/auth/auth.repo';
import { FastifyTokenService } from './modules/auth/token.service';
import { registerAuthRoutes } from './modules/auth/auth.routes';

import { PrismaTeamService } from './modules/team/team.service';
import { registerTeamRoutes } from './modules/team/team.routes';

import { PrismaTenantService } from './modules/tenant/tenant.service';
import { registerTenantRoutes } from './modules/tenant/tenant.routes';

import { PrismaDriverService } from './modules/drivers/driver.service';
import { registerDriverRoutes } from './modules/drivers/driver.routes';

import { PrismaAssetService } from './modules/assets/asset.service';
import { registerAssetRoutes } from './modules/assets/asset.routes';

import { PostgisRouteGeometryService } from './modules/postgis/postgis.service';
import { PrismaEldIngestService } from './modules/eld/eld.ingest.service';
import { registerEldRoutes } from './modules/eld/eld.routes';
import { PrismaHosService } from './modules/hos/hos.service';

import { PrismaFxService } from './modules/fuel/fx.service';
import { PrismaFuelService } from './modules/fuel/fuel.service';
import { registerFuelRoutes } from './modules/fuel/fuel.routes';

import { PrismaLoadService } from './modules/invoicing/load.service';
import { PrismaInvoiceService } from './modules/invoicing/invoice.service';
import { registerInvoicingRoutes } from './modules/invoicing/invoicing.routes';

import { PrismaIftaRepo } from './modules/ifta/ifta.repo';
import { IftaService } from './modules/ifta/ifta.service';
import { resolveRates } from './modules/ifta/jurisdiction-rates';
import { registerIftaRoutes } from './modules/ifta/ifta.routes';

import { PrismaLoadBoardStore } from './modules/board/board.store';
import { LoadBoardService } from './modules/board/board.service';
import { registerBoardRoutes } from './modules/board/board.routes';

import { PrismaTruckStore } from './modules/trucks/truck.store';
import { TruckService } from './modules/trucks/truck.service';
import { registerTruckRoutes } from './modules/trucks/truck.routes';

import { PrismaGeoService } from './modules/geo/geo.service';
import { registerGeoRoutes } from './modules/geo/geo.routes';

import { PrismaMarketService } from './modules/market/market.service';
import { registerMarketRoutes } from './modules/market/market.routes';

import { PrismaSavedSearchService } from './modules/search/saved-search.service';
import { registerSearchRoutes } from './modules/search/saved-search.routes';

import { PrismaNotificationService } from './modules/notification/notification.service';
import { onLoadDispatched, onLoadStatusChanged } from './modules/notification/dispatch-notifier';
import { PrismaLoadDocumentService } from './modules/documents/document.service';
import { registerDocumentRoutes } from './modules/documents/document.routes';
import { PrismaEmailService, tenantEmail } from './modules/notification/email.service';
import { registerNotificationRoutes } from './modules/notification/notification.routes';

import { registerDispatchRoutes } from './modules/dispatch/dispatch.routes';

import { PrismaImportService } from './modules/import/import.service';
import { registerImportRoutes } from './modules/import/import.routes';

import { registerDiagnosticsRoutes } from './modules/diagnostics/diagnostics.routes';

import type { Quarter } from './utils/quarters';
import type { BoardFilters } from './modules/board/board.policy';

export interface AppDeps {
  prisma: PrismaClient;
  bus: EventBus;
  auth: AuthService;
  team: PrismaTeamService;
  tenants: PrismaTenantService;
  drivers: PrismaDriverService;
  assets: PrismaAssetService;
  eldIngest: PrismaEldIngestService;
  hos: PrismaHosService;
  fuel: PrismaFuelService;
  fx: PrismaFxService;
  loads: PrismaLoadService;
  invoices: PrismaInvoiceService;
  ifta: IftaService;
  geometry: PostgisRouteGeometryService;
  board: LoadBoardService;
  trucks: TruckService;
  geo: PrismaGeoService;
  market: PrismaMarketService;
  searches: PrismaSavedSearchService;
  notifications: PrismaNotificationService;
  email: PrismaEmailService;
  documents: PrismaLoadDocumentService;
  importService: PrismaImportService;
}

export interface BuildAppOptions {
  env?: Partial<Record<string, string>>;
  logger?: Logger;
  deps?: Partial<AppDeps>;
}

/**
 * Builds the shared business services. Auth is excluded because it depends on
 * the Fastify JWT signer which only exists after the plugin registration.
 */
function buildBaseServices(
  env: AppEnv,
  logger: Logger,
  prisma: PrismaClient,
  bus: EventBus,
  overrides: Partial<AppDeps>,
): Omit<AppDeps, 'auth' | 'team'> {
  const geometry = overrides.geometry ?? new PostgisRouteGeometryService(prisma);
  const fx = overrides.fx ?? new PrismaFxService(prisma);
  const fuel = overrides.fuel ?? new PrismaFuelService(prisma, bus, fx);
  const loads = overrides.loads ?? new PrismaLoadService(prisma, bus);
  const geo = overrides.geo ?? new PrismaGeoService(prisma);
  const board =
    overrides.board ??
    new LoadBoardService(new PrismaLoadBoardStore(prisma), geo);
  const trucks =
    overrides.trucks ??
    new TruckService(new PrismaTruckStore(prisma), geo);
  const email = overrides.email ?? new PrismaEmailService(prisma, env);
  const notifications =
    overrides.notifications ??
    new PrismaNotificationService(prisma, email, tenantEmail(prisma));
  const market = overrides.market ?? new PrismaMarketService(prisma);
  const searches =
    overrides.searches ??
    new PrismaSavedSearchService(prisma, (tenantId, filters: BoardFilters) =>
      board.listPublic(tenantId, filters),
    );
  const importService = overrides.importService ?? new PrismaImportService(prisma, loads);

  const unlocked: Omit<AppDeps, 'auth' | 'team'> = {
    prisma,
    bus,
    tenants: overrides.tenants ?? new PrismaTenantService(prisma),
    drivers: overrides.drivers ?? new PrismaDriverService(prisma),
    assets: overrides.assets ?? new PrismaAssetService(prisma),
    geometry,
    fx,
    fuel,
    loads,
    hos: overrides.hos ?? new PrismaHosService(prisma),
    eldIngest: overrides.eldIngest ?? new PrismaEldIngestService(prisma, bus, geometry),
    invoices: overrides.invoices ?? new PrismaInvoiceService(prisma, overrides.loads ?? loads),
    ifta:
      overrides.ifta ??
      new IftaService(
        new PrismaIftaRepo(prisma, geometry, overrides.fuel ?? fuel),
        bus,
        resolveRates(env.IFTA_JURISDICTION_RATES),
      ),
    board,
    trucks,
    geo,
    market,
    searches,
    notifications,
    documents: overrides.documents ?? new PrismaLoadDocumentService(prisma),
    email,
    importService,
  };
  void logger;
  return unlocked;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv(opts.env ?? {});
  const logger = opts.logger ?? buildLogger(env.LOG_LEVEL);
  const prisma = opts.deps?.prisma ?? getPrisma();
  const bus = opts.deps?.bus ?? new EventBus(logger);

  const app = Fastify({
    logger,
    trustProxy: true,
    ajv: { customOptions: { allowUnionTypes: true, coerceTypes: false } },
  });

  const server = app as unknown as FastifyInstance;
  const base = buildBaseServices(env, logger, prisma, bus, opts.deps ?? {});

  await app.register(cors, { origin: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await (
    app.register as unknown as (
      plugin: unknown,
      opts: Record<string, unknown>,
    ) => PromiseLike<FastifyInstance>
  )(registerJwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, algorithm: 'HS256' },
    verify: { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, algorithms: ['HS256'] },
  });
  await app.register(authGuardPlugin, { accessType: 'access' });

  const auth =
    opts.deps?.auth ??
    new AuthService(
      new PrismaAuthRepository(prisma),
      new FastifyTokenService(app.jwt, { secret: env.JWT_ACCESS_SECRET, expiresIn: env.JWT_ACCESS_TTL }),
      { accessTtlSeconds: env.JWT_ACCESS_TTL, refreshTtlSeconds: env.JWT_REFRESH_TTL },
    );
  const team =
    opts.deps?.team ??
    new PrismaTeamService(prisma, auth);

  const deps: AppDeps = { ...base, auth, team };

  registerRoutes(server, deps, prisma, env);
  subscribeWorkers(server, deps);
  startSchedule(deps);

  server.setErrorHandler((error: AppError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }
    const fastifyErr = error as { statusCode?: number; code?: string; message?: string };
    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      return reply.code(fastifyErr.statusCode).send({
        error: fastifyErr.code ?? 'REQUEST_ERROR',
        message: fastifyErr.message ?? 'invalid request',
      });
    }
    server.log.error({ err: error, url: request.url }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'internal server error' });
  });

  return server;
}

function registerRoutes(app: FastifyInstance, deps: AppDeps, prisma: PrismaClient, env: AppEnv): void {
  registerAuthRoutes(app, { auth: deps.auth });
  registerTeamRoutes(app, { team: deps.team });
  registerTenantRoutes(app, { tenants: deps.tenants });
  registerDriverRoutes(app, { drivers: deps.drivers });
  registerAssetRoutes(app, { assets: deps.assets });
  registerEldRoutes(app, {
    eldIngest: deps.eldIngest,
    hos: deps.hos,
    eldWebhookSecret: env.ELD_WEBHOOK_SECRET,
  });
  registerFuelRoutes(app, { fuel: deps.fuel, fx: deps.fx });
  registerInvoicingRoutes(app, { loads: deps.loads, invoices: deps.invoices });
  registerIftaRoutes(app, { prisma, bus: deps.bus, fuel: deps.fuel, ifta: deps.ifta });
  registerBoardRoutes(app, { board: deps.board });
  registerTruckRoutes(app, { trucks: deps.trucks });
  registerGeoRoutes(app, { geo: deps.geo });
  registerMarketRoutes(app, { market: deps.market });
  registerSearchRoutes(app, { searches: deps.searches });
  registerNotificationRoutes(app, { notifications: deps.notifications, email: deps.email });
  registerDispatchRoutes(app, { loads: deps.loads });
  registerDocumentRoutes(app, { documents: deps.documents });
  registerImportRoutes(app, { importService: deps.importService });
  registerDiagnosticsRoutes(app, { prisma, env });
}

function startSchedule(deps: AppDeps): void {
  // Backfill today's lane snapshot on boot, then every 6 hours.
  void deps.market.snapshot().catch(() => {});
  const timer = setInterval(() => {
    void deps.market.snapshot().catch(() => {});
  }, 6 * 60 * 60 * 1000);
  timer.unref?.();
}

function subscribeWorkers(app: FastifyInstance, deps: AppDeps): void {
  const bus = deps.bus;

  bus.subscribe<IftaQuarterComputeRequestedPayload>(
    EVENTS.IFTA_QUARTER_COMPUTE_REQUESTED,
    async (payload) => {
      const results = await deps.ifta.requestCompute({
        tenantId: payload.tenantId,
        assetId: payload.assetId,
        driverId: payload.driverId,
        quarter: payload.quarter,
        reason: payload.reason,
      });
      app.log.info(
        { tenantId: payload.tenantId, quarter: payload.quarter, summaries: results.length },
        'IFTA quarter compute finished',
      );
    },
  );

  bus.subscribe<RouteSegmentBatchCompletedPayload>(EVENTS.ROUTE_SEGMENT_BATCH_COMPLETED, async (payload) => {
    const quarter: Quarter = payload.quarter;
    const results = await deps.ifta.requestCompute({
      tenantId: payload.tenantId,
      assetId: payload.assetId,
      driverId: payload.driverId,
      quarter,
      reason: 'ROUTE_BATCH',
    });
    app.log.info(
      { tenantId: payload.tenantId, assetId: payload.assetId, quarter, summaries: results.length },
      'IFTA compute triggered by route segment batch',
    );
  });

  bus.subscribe<FuelTransactionImportedPayload>(EVENTS.FUEL_TRANSACTION_IMPORTED, async (payload) => {
    const results = await deps.ifta.requestCompute({
      tenantId: payload.tenantId,
      assetId: payload.assetId ?? null,
      driverId: null,
      quarter: payload.quarter,
      reason: 'FUEL_IMPORT',
    });
    app.log.info(
      { tenantId: payload.tenantId, quarter: payload.quarter, summaries: results.length },
      'IFTA compute triggered by fuel import',
    );
  });

  bus.subscribe<LoadImportedPayload>(EVENTS.LOAD_IMPORTED, async (payload) => {
    app.log.info({ loadId: payload.loadId }, 'load imported (LoadImported)');
  });

  bus.subscribe<LoadDispatchedPayload>(EVENTS.LOAD_DISPATCHED, async (payload) => {
    await onLoadDispatched({ prisma: deps.prisma, notifications: deps.notifications, logger: app.log }, payload);
  });

  bus.subscribe<LoadStatusChangedPayload>(EVENTS.LOAD_STATUS_CHANGED, async (payload) => {
    await onLoadStatusChanged({ prisma: deps.prisma, notifications: deps.notifications, logger: app.log }, payload);
  });

  bus.subscribe<HosLogUpdatedPayload>(EVENTS.HOS_LOG_UPDATED, async (payload) => {
    app.log.info({ driverId: payload.driverId }, 'HOS log updated');
  });
}