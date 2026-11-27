import app from './app';
import { assertProductionConfig, config } from '@config/index';
import { logger } from '@common/logger';
import prisma from '@database/prisma';
import { aiWorker } from '@modules/ai/worker';
import { maintenance } from '@modules/maintenance/maintenance.service';
import { cancelActiveGenerations } from '@modules/ai/local-intelligence';

const startServer = () => {
  try {
    assertProductionConfig();
  } catch (error) {
    logger.fatal({ err: (error as Error).message }, 'Refusing to start');
    process.exit(1);
  }

  const server = app.listen(config.port, config.bindHost, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv, health: `/api/${config.apiPrefix}/health` },
      'NimbusVault backend listening'
    );
    if (config.ai.worker.enabled) aiWorker.start();
    if (config.maintenance.enabled) maintenance.start();
  });
  // Outlive the load balancer's 60 s idle timeout so it never reuses a socket we just closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    setTimeout(() => process.exit(1), 30_000).unref();
    // Give short requests a chance to complete, then cancel model work safely
    // instead of leaving a disconnected answer running until forced termination.
    const cancelTimer = setTimeout(() => void cancelActiveGenerations(), 10_000);
    cancelTimer.unref();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    await Promise.all([closed, aiWorker.stop(), maintenance.stop()]);
    clearTimeout(cancelTimer);
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

startServer();
