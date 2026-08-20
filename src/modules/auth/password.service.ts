import bcrypt from 'bcrypt';

const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hashValue: string): Promise<boolean> {
  return bcrypt.compare(plain, hashValue);
}
