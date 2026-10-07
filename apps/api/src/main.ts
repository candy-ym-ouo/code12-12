import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { startTaskScheduler } from "./modules/tasks/scheduler";

async function main() {
  await prisma.$connect();
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "自然观察时间线 API 已启动");
  });

  const scheduler = startTaskScheduler();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "收到退出信号，正在关闭服务");
    scheduler?.stop();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (error) => {
  logger.error({ err: error }, "服务启动失败");
  await prisma.$disconnect();
  process.exit(1);
});
