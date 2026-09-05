import { PrismaTeamService } from '../../src/modules/team/team.service';
import type { AuthService, FreshSession } from '../../src/modules/auth/auth.service';
import type { UserRole } from '../../src/modules/auth/auth.types';
import { verifyPassword } from '../../src/modules/auth/password.service';

interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  roles: string;
  driverId: string | null;
  createdAt: Date;
}

interface InviteRow {
  id: string;
  tenantId: string;
  email: string;
  roles: string;
  driverId: string | null;
  invitedById: string | null;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

interface DriverRow {
  id: string;
  tenantId: string;
  name: string;
  status: string;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

class FakeDb {
  users: UserRow[] = [];
  invites: InviteRow[] = [];
  drivers: DriverRow[] = [];

  // Minimal stand-in for the PrismaClient surface TeamService uses.
  user = {
    findUnique: async ({ where }: { where: { email: string } }) =>
      this.users.find((u) => u.email === where.email) ?? null,
    findMany: async ({ where }: { where: { tenantId: string } }) =>
      this.users.filter((u) => u.tenantId === where.tenantId),
    create: async ({ data }: { data: Omit<UserRow, 'id' | 'createdAt'> }) => {
      const row: UserRow = { ...data, id: nextId('user'), createdAt: new Date() };
      this.users.push(row);
      return row;
    },
  };

  driver = {
    findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
      this.drivers.find((d) => d.id === where.id && d.tenantId === where.tenantId) ?? null,
    findMany: async ({ where }: { where: { id: { in: string[] }; tenantId: string } }) =>
      this.drivers.filter((d) => d.tenantId === where.tenantId && where.id.in.includes(d.id)),
  };

  teamInvite = {
    findUnique: async ({ where }: { where: { tokenHash: string } }) =>
      this.invites.find((i) => i.tokenHash === where.tokenHash) ?? null,
    findFirst: async ({
      where,
    }: {
      where: { tenantId: string; email: string; acceptedAt: null; revokedAt: null } | { id: string; tenantId: string; acceptedAt: null };
    }) => {
      const w = where as { tenantId?: string; email?: string; acceptedAt?: null; revokedAt?: null; id?: string };
      return (
        this.invites.find(
          (i) =>
            (w.id === undefined || i.id === w.id) &&
            (w.tenantId === undefined || i.tenantId === w.tenantId) &&
            (w.email === undefined || i.email === w.email) &&
            (w.acceptedAt === undefined || i.acceptedAt === null) &&
            (w.revokedAt === undefined || i.revokedAt === null),
        ) ?? null
      );
    },
    findMany: async ({ where, include }: { where: { tenantId: string }; include?: { driver?: unknown } }) =>
      this.invites
        .filter((i) => i.tenantId === where.tenantId)
        .map((i) => {
          if (!include?.driver) return i;
          const d = this.drivers.find((x) => x.id === i.driverId);
          return { ...i, driver: d ? { name: d.name } : null };
        }),
    create: async ({ data }: { data: Omit<InviteRow, 'id' | 'createdAt'> }) => {
      const row: InviteRow = {
        ...data,
        id: nextId('invite'),
        createdAt: new Date(),
        acceptedAt: data.acceptedAt ?? null,
        revokedAt: data.revokedAt ?? null,
      };
      this.invites.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<InviteRow> }) => {
      const row = this.invites.find((i) => i.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };

  $transaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(this);

  seedDriver(tenantId: string, name = 'Marie Tremblay'): DriverRow {
    const d: DriverRow = { id: nextId('driver'), tenantId, name, status: 'ACTIVE' };
    this.drivers.push(d);
    return d;
  }

  seedUser(tenantId: string, email: string, roles: UserRole[]): UserRow {
    const u: UserRow = {
      id: nextId('user'),
      tenantId,
      email,
      passwordHash: 'x',
      roles: roles.join(','),
      driverId: null,
      createdAt: new Date(),
    };
    this.users.push(u);
    return u;
  }
}

class FakeAuth {
  async sessionForUser(userId: string): Promise<FreshSession> {
    return {
      user: {
        id: userId,
        tenantId: 'tenant-1',
        email: 'accepted@driver.ca',
        roles: ['DRIVER'],
        driverId: 'driver-1',
        createdAt: new Date().toISOString(),
      },
      tenant: {
        id: 'tenant-1',
        name: 'Maple Line Haulers',
        baseCurrency: 'CAD',
        baseJurisdiction: 'QC',
        mcNumber: null,
        usdotNumber: null,
      },
      tokens: {
        accessToken: 'fake-access',
        refreshToken: 'fake-refresh',
        tokenType: 'Bearer',
        accessExpiresIn: 900,
        refreshExpiresIn: 604800,
      },
    };
  }
}

function makeService(db: FakeDb) {
  return new PrismaTeamService(db as never, new FakeAuth() as unknown as AuthService);
}

const past = () => new Date(Date.now() - 60_000);

describe('PrismaTeamService — invites', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('creates a dispatcher invite and returns a raw token (never stored plain)', async () => {
    const db = new FakeDb();
    const service = makeService(db);
    const { invite, token } = await service.createInvite('tenant-1', 'owner-1', {
      email: 'dispatch@carrier.ca',
      roles: ['DISPATCHER'],
    });
    expect(invite.status).toBe('PENDING');
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(db.invites[0].tokenHash).not.toBe(token);
    expect(db.invites[0].tokenHash).toHaveLength(64); // sha256 hex
  });

  it('requires a linked driver record for DRIVER invites', async () => {
    const db = new FakeDb();
    const service = makeService(db);
    await expect(
      service.createInvite('tenant-1', 'owner-1', { email: 'd@x.ca', roles: ['DRIVER'] }),
    ).rejects.toMatchObject({ statusCode: 400 });

    db.seedDriver('tenant-2');
    await expect(
      service.createInvite('tenant-1', 'owner-1', {
        email: 'd@x.ca',
        roles: ['DRIVER'],
        driverId: 'driver-1', // belongs to another tenant
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const driver = db.seedDriver('tenant-1');
    const ok = await service.createInvite('tenant-1', 'owner-1', {
      email: 'd@x.ca',
      roles: ['DRIVER'],
      driverId: driver.id,
    });
    expect(ok.invite.driverId).toBe(driver.id);
  });

  it('rejects a driverId on non-DRIVER invites', async () => {
    const db = new FakeDb();
    const service = makeService(db);
    await expect(
      service.createInvite('tenant-1', 'owner-1', {
        email: 'a@x.ca',
        roles: ['ADMIN'],
        driverId: 'driver-1',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('blocks invites for emails that already have an account or a pending invite', async () => {
    const db = new FakeDb();
    const service = makeService(db);
    db.seedUser('tenant-1', 'taken@x.ca', ['ADMIN']);
    await expect(
      service.createInvite('tenant-1', 'owner-1', { email: 'taken@x.ca', roles: ['DISPATCHER'] }),
    ).rejects.toMatchObject({ statusCode: 409 });

    await service.createInvite('tenant-1', 'owner-1', { email: 'pending@x.ca', roles: ['DISPATCHER'] });
    await expect(
      service.createInvite('tenant-1', 'owner-1', { email: 'pending@x.ca', roles: ['DISPATCHER'] }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('revokes pending invites and rejects revoking used ones', async () => {
    const db = new FakeDb();
    const service = makeService(db);
    const { invite } = await service.createInvite('tenant-1', 'owner-1', { email: 'r@x.ca', roles: ['DRIVER'], driverId: db.seedDriver('tenant-1').id });
    await service.revoke('tenant-1', invite.id);
    expect(db.invites[0].revokedAt).not.toBeNull();
    await expect(service.revoke('tenant-1', invite.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('resend rotates the token and refreshes the expiry', async () => {
    const db = new FakeDb();
    const service = makeService(db);
    const { invite, token } = await service.createInvite('tenant-1', 'owner-1', { email: 'r@x.ca', roles: ['DISPATCHER'] });
    db.invites[0].expiresAt = past();
    const { token: next } = await service.resend('tenant-1', invite.id);
    expect(next).not.toBe(token);
    expect(db.invites[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('accepts a valid invite: creates the user with invite roles and links the driver', async () => {
    const db = new FakeDb();
    const service = makeService(db);
    const driver = db.seedDriver('tenant-1', 'Marie Tremblay');
    const { token } = await service.createInvite('tenant-1', 'owner-1', {
      email: 'Marie@Driver.CA',
      roles: ['DRIVER'],
      driverId: driver.id,
    });

    const session = await service.accept({ token, email: 'marie@driver.ca', password: 'supersecret' });
    expect(session.user.id).toBeTruthy(); // FakeAuth mints the session for the created user

    const stored = db.users.find((u) => u.email === 'marie@driver.ca');
    expect(stored).toBeDefined();
    expect(stored?.tenantId).toBe('tenant-1');
    expect(stored?.roles).toBe('DRIVER');
    expect(stored?.driverId).toBe(driver.id);
    expect(await verifyPassword('supersecret', stored!.passwordHash)).toBe(true);
    expect(db.invites[0].acceptedAt).not.toBeNull();
  });

  it('rejects an invite that is expired, revoked, used, or for another email', async () => {
    const db = new FakeDb();
    const service = makeService(db);

    const expired = await service.createInvite('tenant-1', 'owner-1', { email: 'e@x.ca', roles: ['DISPATCHER'] });
    db.invites[db.invites.length - 1].expiresAt = past();
    await expect(service.accept({ token: expired.token, email: 'e@x.ca', password: 'supersecret' })).rejects.toMatchObject({ statusCode: 400 });

    const revoked = await service.createInvite('tenant-1', 'owner-1', { email: 'v@x.ca', roles: ['DISPATCHER'] });
    db.invites[db.invites.length - 1].revokedAt = new Date();
    await expect(service.accept({ token: revoked.token, email: 'v@x.ca', password: 'supersecret' })).rejects.toMatchObject({ statusCode: 400 });

    const used = await service.createInvite('tenant-1', 'owner-1', { email: 'u@x.ca', roles: ['DISPATCHER'] });
    db.invites[db.invites.length - 1].acceptedAt = new Date();
    await expect(service.accept({ token: used.token, email: 'u@x.ca', password: 'supersecret' })).rejects.toMatchObject({ statusCode: 400 });

    const wrongEmail = await service.createInvite('tenant-1', 'owner-1', { email: 'me@x.ca', roles: ['DISPATCHER'] });
    await expect(service.accept({ token: wrongEmail.token, email: 'other@x.ca', password: 'supersecret' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects an invite when the email already registered or the password is short', async () => {
    const db = new FakeDb();
    const service = makeService(db);
    const { token } = await service.createInvite('tenant-1', 'owner-1', { email: 'p@x.ca', roles: ['DISPATCHER'] });
    await expect(service.accept({ token, email: 'p@x.ca', password: 'short' })).rejects.toMatchObject({ statusCode: 400 });

    db.seedUser('tenant-9', 'p@x.ca', ['ADMIN']); // same email, different tenant — globally unique
    await expect(service.accept({ token, email: 'p@x.ca', password: 'supersecret' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('lists members and invite statuses', async () => {
    const db = new FakeDb();
    const service = makeService(db);
    db.seedUser('tenant-1', 'owner@x.ca', ['ADMIN']);
    const driver = db.seedDriver('tenant-1');
    const { invite } = await service.createInvite('tenant-1', 'owner-1', {
      email: 'd@x.ca',
      roles: ['DRIVER'],
      driverId: driver.id,
    });

    const { members, invites } = await service.list('tenant-1');
    expect(members).toHaveLength(1);
    expect(members[0].email).toBe('owner@x.ca');
    expect(invites[0].id).toBe(invite.id);
    expect(invites[0].status).toBe('PENDING');
    expect(invites[0].driverName).toBe('Marie Tremblay');
  });
});
