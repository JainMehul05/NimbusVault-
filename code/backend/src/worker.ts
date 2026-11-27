/**
 * Standalone background process: AI indexing plus periodic maintenance, without the HTTP API.
 * On ECS this runs as its own service so indexing load never competes with request handling.
 */
import { writeFile } from 'fs/promises';
import { assertProductionConfig, config } from '@config/index';
import { logger } from '@common/logger';
import prisma from '@database/prisma';
import { aiWorker } from '@modules/ai/worker';
import { maintenance } from '@modules/maintenance/maintenance.service';

try {
  assertProductionConfig();
} catch (error) {
  logger.fatal({ err: (error as Error).message }, 'Refusing to start');
  process.exit(1);
}

const heartbeat = async () => {
  if (!config.ai.worker.heartbeatFile) return;
  try {
    // Proves both the event loop and the database connection are alive.
    await prisma.$queryRaw`SELECT 1`;
    await writeFile(config.ai.worker.heartbeatFile, new Date().toISOString());
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Worker heartbeat failed');
  }
};

logger.info('NimbusVault worker starting');
aiWorker.start();
maintenance.start();
void heartbeat();
// Not unref'd: keeps the process alive even when AI is not configured.
const timer = setInterval(() => void heartbeat(), 15_000);

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Worker shutting down');
  clearInterval(timer);
  setTimeout(() => process.exit(1), 30_000).unref();
  await Promise.all([aiWorker.stop(), maintenance.stop()]);
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
