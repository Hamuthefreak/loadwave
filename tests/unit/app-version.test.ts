import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '../../src/config/env';

/**
 * /api/health reports APP_VERSION so a deploy can be confirmed from outside the
 * box. That only works if the marker tracks the release, and it did not: the
 * schema default was a hardcoded '1.0.0', so a server running 1.1.0 still
 * answered "1.0.0" and the probe was useless exactly when it was needed.
 */
describe('APP_VERSION release marker', () => {
  const required = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/loadwave',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };

  const packageVersion = (): string =>
    (JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string })
      .version;

  it('defaults to the version in package.json, not a hardcoded literal', () => {
    delete process.env.APP_VERSION;
    expect(loadEnv(required).APP_VERSION).toBe(packageVersion());
  });

  it('still lets an explicit APP_VERSION win, so it stays overridable', () => {
    expect(loadEnv({ ...required, APP_VERSION: '9.9.9-test' }).APP_VERSION).toBe('9.9.9-test');
  });
});
