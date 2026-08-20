import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export type { PrismaClient };
export type { Decimal as PrismaDecimal };

export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'
>;

let instance: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!instance) {
    instance = new PrismaClient();
  }
  return instance;
}

export function isPrismaDecimal(v: unknown): v is Decimal {
  return v instanceof Decimal;
}
