import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { scanAllTasks } from "./service";

/**
 * 观察任务扫描定时器：按 TASK_SCAN_INTERVAL_MIN 周期推进所有活动任务。
 * 扫描本身按 (taskId, year) 唯一约束幂等，多实例/重启重叠执行也安全。
 */
export function startTaskScheduler(): { stop: () => void } | null {
  if (env.isTest) return null;

  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await scanAllTasks();
      if (
        result.instancesCreated ||
        result.remindersSent ||
        result.overdueMarked ||
        result.autoCompleted ||
        result.autoBackfilled
      ) {
        logger.info(result, "观察任务扫描完成");
      }
    } catch (error) {
      logger.error({ err: error }, "观察任务扫描定时器异常");
    } finally {
      running = false;
    }
  };

  // 启动后稍等片刻执行首轮扫描，避免与进程启动争用数据库连接。
  const initial = setTimeout(() => void tick(), 5_000);
  initial.unref();
  const timer = setInterval(() => void tick(), env.TASK_SCAN_INTERVAL_MIN * 60_000);
  timer.unref();

  logger.info(
    { intervalMin: env.TASK_SCAN_INTERVAL_MIN },
    "观察任务扫描定时器已启动（按任务各自时区计算当天）",
  );

  return {
    stop() {
      stopped = true;
      clearTimeout(initial);
      clearInterval(timer);
    },
  };
}
