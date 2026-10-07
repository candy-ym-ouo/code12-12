import path from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";

// 开发时 __dirname 为 src/config，构建后为 dist/src/config，向上寻找 packages.json 定位 apps/api
function findApiRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

const apiRoot = findApiRoot(__dirname);

dotenv.config({ path: path.resolve(apiRoot, ".env") });

const booleanish = z
  .union([z.string(), z.boolean()])
  .transform((value) => value === true || value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL 不能为空"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET 至少需要 32 个字符"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(10),
  MAX_PHOTOS_PER_OBSERVATION: z.coerce.number().int().positive().default(9),
  STRIP_GPS_DEFAULT: booleanish.default(true),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  TASK_SCAN_INTERVAL_MIN: z.coerce.number().int().positive().default(60),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  console.error(`环境变量校验失败，请检查 apps/api/.env：\n${details}`);
  process.exit(1);
}

const raw = parsed.data;
const uploadDir = path.isAbsolute(raw.UPLOAD_DIR) ? raw.UPLOAD_DIR : path.resolve(apiRoot, raw.UPLOAD_DIR);

export const env = {
  ...raw,
  apiRoot,
  uploadDir,
  isDev: raw.NODE_ENV === "development",
  isTest: raw.NODE_ENV === "test",
  isProd: raw.NODE_ENV === "production",
  maxFileSizeBytes: Math.round(raw.MAX_FILE_SIZE_MB * 1024 * 1024),
  jwtIssuer: "nature-timeline",
  jwtAudience: "nature-timeline-web",
  refreshCookieName: "nt_refresh",
  refreshCookiePath: "/api/v1/auth",
};

if (env.S3_BUCKET) {
  console.error(
    "检测到 S3_BUCKET 配置，但当前构建仅内置本地磁盘存储适配器。\n" +
      "请取消 S3_BUCKET 后启动，或在 src/lib/storage 中实现 S3Storage 适配器。",
  );
  process.exit(1);
}
