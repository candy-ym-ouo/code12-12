import { env } from "../config/env";
import { logger } from "../lib/logger";
import { scanAllUsers } from "../modules/tasks/service";

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runScan(trigger: string): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  try {
    const result = await scanAllUsers();
    logger.info({ trigger, ...result, durationMs: Date.now() - startedAt }, "观察任务扫描完成");
  } catch (error) {
    logger.error({ err: error, trigger }, "观察任务扫描失败");
  } finally {
    running = false;
  }
}

export function startTaskScheduler(): void {
  if (timer || env.isTest) return;
  void runScan("startup");
  timer = setInterval(() => void runScan("scheduled"), SCAN_INTERVAL_MS);
  timer.unref();
}

export function stopTaskScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
