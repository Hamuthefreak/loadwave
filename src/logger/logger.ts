import pino from 'pino';

export function buildLogger(level: string): pino.Logger {
  const isProd = process.env.NODE_ENV === 'production';
  return pino({
    level,
    base: undefined,
    redact: {
      paths: ['req.headers.authorization', '*.passwordHash', '*.token'],
      censor: '[redacted]',
    },
    ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  });
}
