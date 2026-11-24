import app from './app';
import { assertProductionConfig, config } from '@config/index';
import { logger } from '@common/logger';
import prisma from '@database/prisma';
import { aiWorker } from '@modules/ai/worker';

const startServer = () => {
  try {
    assertProductionConfig();
  } catch (error) {
    logger.fatal({ err: (error as Error).message }, 'Refusing to start');
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv, health: `/api/${config.apiPrefix}/health` },
      'NimbusVault backend listening'
    );
    if (config.ai.worker.enabled) aiWorker.start();
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    server.close();
    await aiWorker.stop();
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

startServer();
