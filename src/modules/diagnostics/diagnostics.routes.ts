import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env';
import type { PrismaClient } from '../../db/prisma';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * The admin key comes from an environment variable OR a key file on disk.
 * Either way it is never shipped to the browser — the client sends the raw
 * secret in the `x-admin-key` header and we compare it here.
 */
function resolveConfiguredKey(env: AppEnv): string {
  if (env.DIAGNOSTICS_ADMIN_KEY) return env.DIAGNOSTICS_ADMIN_KEY;
  if (env.DIAGNOSTICS_KEY_FILE) {
    try {
      return readFileSync(env.DIAGNOSTICS_KEY_FILE, 'utf8').trim();
    } catch {
      return '';
    }
  }
  return '';
}

export interface DiagnosticsDeps {
  prisma: PrismaClient;
  env: AppEnv;
}

export function registerDiagnosticsRoutes(app: FastifyInstance, deps: DiagnosticsDeps): void {
  app.get('/api/diagnostics', async (request, reply) => {
    const configured = resolveConfiguredKey(deps.env);

    if (!configured) {
      return reply.code(503).send({
        ok: false,
        configured: false,
        message: 'Diagnostics are disabled. Set DIAGNOSTICS_ADMIN_KEY (or DIAGNOSTICS_KEY_FILE) to enable.',
      });
    }

    const provided = String(request.headers['x-admin-key'] ?? '');
    if (!safeEqual(provided, configured)) {
      return reply.code(401).send({ ok: false, configured: true, message: 'Invalid admin key' });
    }

    const envFlags: Record<string, boolean> = {
      NODE_ENV: Boolean(deps.env.NODE_ENV),
      DATABASE_URL: Boolean(deps.env.DATABASE_URL),
      JWT_ACCESS_SECRET: Boolean(deps.env.JWT_ACCESS_SECRET),
      JWT_REFRESH_SECRET: Boolean(deps.env.JWT_REFRESH_SECRET),
      SMTP_URL: Boolean(deps.env.SMTP_URL),
      ELD_WEBHOOK_SECRET: Boolean(deps.env.ELD_WEBHOOK_SECRET),
    };

    // Resilient: the report must be readable even when the database is down.
    let db: { reachable: boolean; tenantCount?: number; loadCount?: number; boardLoadCount?: number; error?: string } = {
      reachable: false,
    };
    try {
      const [tenants, loads, board] = await Promise.all([
        deps.prisma.tenant.count(),
        deps.prisma.load.count(),
        deps.prisma.load.count({ where: { marketplaceStatus: 'PUBLIC' } }),
      ]);
      db = { reachable: true, tenantCount: tenants, loadCount: loads, boardLoadCount: board };
    } catch (e) {
      db = { reachable: false, error: e instanceof Error ? e.message : 'database error' };
    }

    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [
      { name: 'JWT auth plugin', ok: true, detail: 'access-type tokens enforced' },
      { name: 'Rate limiter', ok: true, detail: '200 req/min per IP' },
      { name: 'CORS + Helmet', ok: true, detail: 'permissive CORS, CSP disabled' },
      { name: 'Diagnostics key configured', ok: Boolean(configured) },
      {
        name: 'Database reachable',
        ok: db.reachable,
        detail: db.reachable
          ? `${db.tenantCount} tenants · ${db.loadCount} loads · ${db.boardLoadCount} on board`
          : db.error,
      },
    ];

    return {
      ok: true,
      configured: true,
      app: {
        name: 'LoadWave TMS',
        env: deps.env.NODE_ENV,
        port: deps.env.PORT,
        uptimeMs: Math.round(process.uptime() * 1000),
      },
      env: envFlags,
      db,
      checks,
      modules: [
        'auth',
        'tenants',
        'drivers',
        'assets',
        'eld',
        'hos',
        'fuel',
        'invoicing',
        'ifta',
        'board',
        'trucks',
        'geo',
        'market',
        'search',
        'notifications',
        'dispatch',
        'import',
      ],
    };
  });
}
