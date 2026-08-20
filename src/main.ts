import { loadEnv } from './config/env';
import { buildLogger } from './logger/logger';
import { buildApp } from './app';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = buildLogger(env.LOG_LEVEL);
  const app = await buildApp({ logger });

  const shutdown = async (signal: string): Promise<void> => {
    try {
      await app.close();
    } finally {
      process.kill(process.pid, signal as NodeJS.Signals);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info({ address }, 'LoadWave TMS backend started');
  } catch (err) {
    app.log.error(err, 'failed to start server');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
