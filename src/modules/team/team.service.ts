import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../auth/password.service';
import type { AuthService, FreshSession } from '../auth/auth.service';
import { ROLES, stringifyRoles, type UserRole } from '../auth/auth.types';
import { badRequest, conflict, notFound, unauthorized } from '../../utils/errors';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface TeamMemberRow {
  id: string;
  email: string;
  roles: UserRole[];
  driverId: string | null;
  driverName: string | null;
  createdAt: string;
}

export interface TeamInviteRow {
  id: string;
  email: string;
  roles: UserRole[];
  driverId: string | null;
  driverName: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}

export interface CreateInviteInput {
  email: string;
  roles: UserRole[];
  driverId?: string | null;
}

export interface AcceptInviteInput {
  token: string;
  email: string;
  password: string;
}

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

function parseRolesCsv(csv: string): UserRole[] {
  return csv
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is UserRole => (ROLES as readonly string[]).includes(r));
}

export interface TeamService {
  list(tenantId: string): Promise<{ members: TeamMemberRow[]; invites: TeamInviteRow[] }>;
  createInvite(tenantId: string, invitedById: string, input: CreateInviteInput): Promise<{ invite: TeamInviteRow; token: string }>;
  revoke(tenantId: string, inviteId: string): Promise<void>;
  /** Rotates the token of a pending invite so its link can be shared again. */
  resend(tenantId: string, inviteId: string): Promise<{ token: string }>;
  accept(input: AcceptInviteInput): Promise<FreshSession>;
}

/**
 * Team membership: admin-invited users join an existing tenant with fixed
 * roles. Raw invite tokens are handed out once at creation and stored hashed;
 * acceptance creates the User (password set by the invitee) and links any
 * driver record chosen at invite time.
 */
export class PrismaTeamService implements TeamService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  async list(tenantId: string): Promise<{ members: TeamMemberRow[]; invites: TeamInviteRow[] }> {
    const [users, invites] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.teamInvite.findMany({
        where: { tenantId },
        include: { driver: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // User.driverId is a plain column (no relation), so resolve driver names
    // in one extra query instead.
    const driverIds = [...new Set(users.map((u) => u.driverId).filter((id): id is string => Boolean(id)))];
    const drivers = driverIds.length
      ? await this.prisma.driver.findMany({
          where: { id: { in: driverIds }, tenantId },
          select: { id: true, name: true },
        })
      : [];
    const driverNames = new Map(drivers.map((d) => [d.id, d.name]));

    const members: TeamMemberRow[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      roles: parseRolesCsv(u.roles),
      driverId: u.driverId,
      driverName: u.driverId ? (driverNames.get(u.driverId) ?? null) : null,
      createdAt: u.createdAt.toISOString(),
    }));

    const now = Date.now();
    const inviteRows: TeamInviteRow[] = invites.map((i) => {
      const status: TeamInviteRow['status'] = i.acceptedAt
        ? 'ACCEPTED'
        : i.revokedAt
          ? 'REVOKED'
          : i.expiresAt.getTime() < now
            ? 'EXPIRED'
            : 'PENDING';
      return {
        id: i.id,
        email: i.email,
        roles: parseRolesCsv(i.roles),
        driverId: i.driverId,
        driverName: i.driver?.name ?? null,
        status,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
      };
    });

    return { members, invites: inviteRows };
  }

  async createInvite(
    tenantId: string,
    invitedById: string,
    input: CreateInviteInput,
  ): Promise<{ invite: TeamInviteRow; token: string }> {
    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes('@')) throw badRequest('a valid email is required');

    const roles = [...new Set(input.roles)];
    if (roles.length === 0) throw badRequest('choose at least one role');
    for (const r of roles) {
      if (!(ROLES as readonly string[]).includes(r)) throw badRequest(`unknown role ${r}`);
    }

    const wantsDriver = roles.includes('DRIVER');
    if (wantsDriver && !input.driverId) {
      throw badRequest('pick the driver record to link — DRIVER accounts log into the driver app');
    }
    if (!wantsDriver && input.driverId) {
      throw badRequest('a driver link is only valid for DRIVER accounts');
    }
    if (input.driverId) {
      const driver = await this.prisma.driver.findFirst({
        where: { id: input.driverId, tenantId },
        select: { id: true },
      });
      if (!driver) throw badRequest('the selected driver does not belong to this carrier');
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) throw conflict('that email already has an account — ask them to sign in instead');

    const pending = await this.prisma.teamInvite.findFirst({
      where: { tenantId, email, acceptedAt: null, revokedAt: null },
      select: { id: true },
    });
    if (pending) throw conflict('an invite is already pending for that email');

    const token = crypto.randomBytes(32).toString('base64url');
    const invite = await this.prisma.teamInvite.create({
      data: {
        tenantId,
        email,
        roles: stringifyRoles(roles),
        driverId: input.driverId ?? null,
        invitedById,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    return {
      invite: {
        id: invite.id,
        email: invite.email,
        roles: parseRolesCsv(invite.roles),
        driverId: invite.driverId,
        driverName: null,
        status: 'PENDING',
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
      },
      token,
    };
  }

  async revoke(tenantId: string, inviteId: string): Promise<void> {
    const existing = await this.prisma.teamInvite.findFirst({
      where: { id: inviteId, tenantId, acceptedAt: null, revokedAt: null },
    });
    if (!existing) throw notFound('pending invite not found');
    await this.prisma.teamInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
  }

  async resend(tenantId: string, inviteId: string): Promise<{ token: string }> {
    const existing = await this.prisma.teamInvite.findFirst({
      where: { id: inviteId, tenantId, acceptedAt: null },
    });
    if (!existing) throw notFound('pending invite not found');
    if (existing.revokedAt) throw badRequest('this invite was revoked and cannot be resent');
    const token = crypto.randomBytes(32).toString('base64url');
    await this.prisma.teamInvite.update({
      where: { id: inviteId },
      data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    });
    return { token };
  }

  async accept(input: AcceptInviteInput): Promise<FreshSession> {
    const tokenHash = sha256(input.token);
    const invite = await this.prisma.teamInvite.findUnique({ where: { tokenHash } });
    if (!invite) throw unauthorized('this invite link is invalid');
    if (invite.acceptedAt) throw badRequest('this invite has already been used');
    if (invite.revokedAt) throw badRequest('this invite was revoked');
    if (invite.expiresAt.getTime() < Date.now()) throw badRequest('this invite has expired');

    const email = input.email.trim().toLowerCase();
    if (email !== invite.email.toLowerCase()) {
      throw unauthorized('this invite was issued to a different email');
    }
    if (!input.password || input.password.length < 8) {
      throw badRequest('password must be at least 8 characters');
    }

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw conflict('that email already has an account');

    const roles = parseRolesCsv(invite.roles);
    const passwordHash = await hashPassword(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId: invite.tenantId,
          email,
          passwordHash,
          roles: stringifyRoles(roles),
          driverId: invite.driverId ?? null,
        },
      });
      await tx.teamInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      return created;
    });

    return this.auth.sessionForUser(user.id);
  }
}
