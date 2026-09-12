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
import { registerMessageRoutes } from './modules/messages/messages.routes';
import { PrismaMessageService } from './modules/messages/messages.service';
import { PrismaRatingRepo } from './modules/ratings/rating.repo';
import { PrismaRatingService } from './modules/ratings/rating.service';
import { registerRatingRoutes } from './modules/ratings/rating.routes';
import { registerDetentionRoutes } from './modules/detention/detention.routes';
import { PrismaDetentionService } from './modules/detention/detention.service';
import { runRecurrenceSweep } from './modules/recurring/recurring.service';

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
import { createPushService, type PushService } from './modules/notification/push.service';
import { registerPushRoutes } from './modules/notification/push.routes';
import { onSessionIssued } from './modules/notification/auth-notifier';
import { PrismaLoadDocumentService } from './modules/documents/document.service';
import { registerDocumentRoutes } from './modules/documents/document.routes';
import { PrismaEmailService, tenantEmail } from './modules/notification/email.service';
import { registerNotificationRoutes } from './modules/notification/notification.routes';

import { registerDispatchRoutes } from './modules/dispatch/dispatch.routes';

import { PrismaImportService } from './modules/import/import.service';
import { registerImportRoutes } from './modules/import/import.routes';

import { registerDiagnosticsRoutes } from './modules/diagnostics/diagnostics.routes';
import { registerHealthRoutes } from './modules/health/health.routes';

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
  messages: PrismaMessageService;
  ratings: PrismaRatingService;
  trucks: TruckService;
  geo: PrismaGeoService;
  market: PrismaMarketService;
  searches: PrismaSavedSearchService;
  notifications: PrismaNotificationService;
  email: PrismaEmailService;
  documents: PrismaLoadDocumentService;
  importService: PrismaImportService;
  push: PushService;
  detention: PrismaDetentionService;
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
  const email = overrides.email ?? new PrismaEmailService(prisma, env, logger);
  const notifications =
    overrides.notifications ??
    new PrismaNotificationService(prisma, email, tenantEmail(prisma));
  const messages =
    overrides.messages ?? new PrismaMessageService(prisma, notifications);
  const ratings = overrides.ratings ?? new PrismaRatingService(new PrismaRatingRepo(prisma));
  const market = overrides.market ?? new PrismaMarketService(prisma);
  const searches =
    overrides.searches ??
    new PrismaSavedSearchService(prisma, (tenantId, filters: BoardFilters) =>
      board.listPublic(tenantId, filters),
    );
  const importService = overrides.importService ?? new PrismaImportService(prisma, loads);
  const push =
    overrides.push ??
    createPushService({
      // Structural slice of the real delegate (upsert/findMany/deleteMany).
      prisma: prisma.pushSubscription as unknown as Parameters<typeof createPushService>[0]['prisma'],
      vapidPublicKey: env.VAPID_PUBLIC_KEY,
      vapidPrivateKey: env.VAPID_PRIVATE_KEY,
      vapidSubject: env.VAPID_SUBJECT,
      logger,
    });

  const unlocked: Omit<AppDeps, 'auth' | 'team'> = {
    prisma,
    bus,
    messages,
    ratings,
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
    push,
    detention: overrides.detention ?? new PrismaDetentionService(prisma),
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

  // Same-origin deployments (nginx serves both SPA and API) need no CORS at
  // all. Set CORS_ORIGIN to a comma-separated allowlist only when the API is
  // served from a different origin than the app.
  const corsOrigin: string[] | false = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : false;
  await app.register(cors, { origin: corsOrigin });
  await app.register(helmet, {
    // The SPA is React + Vite: production bundles use external scripts/styles
    // and no inline scripts, so a strict CSP is safe there. Dev mode needs
    // inline injection + websockets, so the policy only applies in production.
    contentSecurityPolicy:
      env.NODE_ENV === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"], // React inline style attributes
              imgSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              fontSrc: ["'self'", 'data:'],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              upgradeInsecureRequests: [],
            },
          }
        : false,
  });
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
      {
        accessTtlSeconds: env.JWT_ACCESS_TTL,
        refreshTtlSeconds: env.JWT_REFRESH_TTL,
        rememberedRefreshTtlSeconds: env.JWT_REMEMBER_TTL,
        appUrl: env.APP_URL,
        isProd: env.NODE_ENV === 'production',
        // Alerts (bell + email once SMTP is live) when a session comes from a
        // device this account has never signed in from before.
        onSessionIssued: (info) => onSessionIssued({ notifications: base.notifications, logger }, info),
      },
      base.email,
    );
  const team =
    opts.deps?.team ??
    new PrismaTeamService(prisma, auth);

  const deps: AppDeps = { ...base, auth, team };

  registerRoutes(server, deps, prisma, env);
  subscribeWorkers(server, deps);
  startSchedule(deps, logger);

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
  registerAuthRoutes(app, {
    auth: deps.auth,
    email: deps.email,
    appUrl: env.APP_URL,
    isProd: env.NODE_ENV === 'production',
  });
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
  registerMessageRoutes(app, { messages: deps.messages });
  registerRatingRoutes(app, { ratings: deps.ratings });
  registerTruckRoutes(app, { trucks: deps.trucks });
  registerGeoRoutes(app, { geo: deps.geo });
  registerMarketRoutes(app, { market: deps.market });
  registerSearchRoutes(app, { searches: deps.searches });
  registerNotificationRoutes(app, { notifications: deps.notifications, email: deps.email });
  registerPushRoutes(app, { push: deps.push });
  registerDispatchRoutes(app, { loads: deps.loads, detention: deps.detention });
  registerDetentionRoutes(app, { detention: deps.detention });
  registerDocumentRoutes(app, { documents: deps.documents });
  registerImportRoutes(app, { importService: deps.importService });
  registerDiagnosticsRoutes(app, { prisma, env });
  registerHealthRoutes(app, { prisma });
}

function startSchedule(deps: AppDeps, logger: Logger): void {
  // Backfill today's lane snapshot on boot, then every 6 hours.
  const snapshot = (): void => {
    void deps.market
      .snapshot()
      .catch((err: unknown) => logger.warn({ err }, 'market lane snapshot failed'));
  };
  snapshot();
  const timer = setInterval(snapshot, 6 * 60 * 60 * 1000);
  timer.unref?.();

  // Saved-search load alerts: first sweep shortly after boot, then every 5 min.
  const sweep = (): void => {
    void deps.searches
      .runAlerts(deps.notifications)
      .catch((err: unknown) => logger.warn({ err }, 'saved-search alert sweep failed'));
  };
  const alertTimer = setInterval(sweep, 5 * 60 * 1000);
  alertTimer.unref?.();
  setTimeout(sweep, 20_000);

  // Recurring loads: clone any due weekly load, then hourly afterwards.
  const recurrence = (): void => {
    void runRecurrenceSweep(deps.prisma, logger).catch((err: unknown) =>
      logger.warn({ err }, 'recurring load sweep failed'),
    );
  };
  const recTimer = setInterval(recurrence, 60 * 60 * 1000);
  recTimer.unref?.();
  setTimeout(recurrence, 30_000);
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
    await onLoadDispatched(
      { prisma: deps.prisma, notifications: deps.notifications, push: deps.push, logger: app.log },
      payload,
    );
  });

  bus.subscribe<LoadStatusChangedPayload>(EVENTS.LOAD_STATUS_CHANGED, async (payload) => {
    await onLoadStatusChanged(
      { prisma: deps.prisma, notifications: deps.notifications, push: deps.push, logger: app.log },
      payload,
    );
  });

  bus.subscribe<HosLogUpdatedPayload>(EVENTS.HOS_LOG_UPDATED, async (payload) => {
    app.log.info({ driverId: payload.driverId }, 'HOS log updated');
  });
}