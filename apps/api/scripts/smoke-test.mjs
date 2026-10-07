/**
 * 闭环冒烟测试：对着真实运行的服务走一遍主链路。
 * 用法：pnpm --filter @nature/api smoke  （需要 API 已在 http://localhost:3000 运行）
 */
import sharp from "sharp";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const API = `${BASE}/api/v1`;

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? `：${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`);
  }
}

async function call(path, { method = "GET", token, body, raw = false, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  const text = await response.text();
  const payload = raw ? text : text ? JSON.parse(text) : null;
  return { status: response.status, body: payload, headers: response.headers };
}

async function main() {
  console.log(`\n闭环冒烟测试 → ${API}\n`);

  const health = await call("/healthz");
  check("健康检查可用", health.status === 200 && health.body?.data?.status === "ok");

  const email = `smoke-${Date.now()}@example.com`;
  const register = await call("/auth/register", {
    method: "POST",
    body: { email, password: "Nature#2025", displayName: "冒烟测试" },
  });
  check("注册并拿到访问令牌", register.status === 201 && Boolean(register.body?.data?.accessToken), `status=${register.status}`);
  const token = register.body?.data?.accessToken;

  const site = await call("/sites", {
    method: "POST",
    token,
    body: { name: `冒烟测试点 ${Date.now()}`, latitude: 39.98, longitude: 116.31, habitat: "校园绿地" },
  });
  check("创建观察地点", site.status === 201 && Boolean(site.body?.data?.id), `status=${site.status}`);
  const siteId = site.body?.data?.id;

  const imported = await call("/species/import-preset", {
    method: "POST",
    token,
    body: { presetId: "preset-ginkgo" },
  });
  check("导入预置物种（含物候阶段）", imported.status === 201 && imported.body?.data?.phenophases?.length >= 4,
    `status=${imported.status}`);
  const speciesId = imported.body?.data?.id;
  const phase = imported.body?.data?.phenophases?.find((item) => item.name === "发芽");
  check("物候阶段包含「发芽」", Boolean(phase?.id));

  const first = await call("/observations", {
    method: "POST",
    token,
    body: {
      siteId,
      speciesId,
      phenophaseId: phase?.id,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2024-03-18",
      notes: "芽鳞微裂",
    },
  });
  check("创建 2024-03-18 观测", first.status === 201, `status=${first.status}`);

  const second = await call("/observations", {
    method: "POST",
    token,
    body: {
      siteId,
      speciesId,
      phenophaseId: phase?.id,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-03-12",
      notes: "约三分之一芽已显绿",
    },
  });
  check("创建 2025-03-12 观测", second.status === 201, `status=${second.status}`);

  const duplicate = await call("/observations", {
    method: "POST",
    token,
    body: {
      siteId,
      speciesId,
      phenophaseId: phase?.id,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-03-12",
    },
  });
  check("重复观测被拦截（409）", duplicate.status === 409 && duplicate.body?.error?.code === "DUPLICATE_OBSERVATION",
    `status=${duplicate.status}`);

  const jpeg = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 62, g: 110, b: 78 } },
  })
    .jpeg()
    .toBuffer();

  const form = new FormData();
  form.append("files", new Blob([jpeg], { type: "image/jpeg" }), "ginkgo-bud.jpg");
  const upload = await call(`/observations/${second.body?.data?.id}/photos`, { method: "POST", token, formData: form });
  check("上传照片并生成缩略图", upload.status === 201 && upload.body?.data?.succeeded?.length === 1,
    `status=${upload.status}`);

  const thumbUrl = upload.body?.data?.succeeded?.[0]?.thumbUrl;
  if (thumbUrl) {
    const image = await fetch(`${BASE}${thumbUrl}`);
    check("缩略图可访问", image.status === 200 && image.headers.get("content-type")?.includes("image/webp"),
      `status=${image.status}`);
  }

  const timeline = await call(`/observations?siteId=${siteId}&limit=20`, { token });
  check("时间线返回两条记录", timeline.status === 200 && timeline.body?.data?.length === 2,
    `count=${timeline.body?.data?.length}`);

  const compare = await call(
    `/stats/compare?siteId=${siteId}&speciesId=${speciesId}&phenophaseId=${phase?.id}&years=2024,2025`,
    { token },
  );
  const y2025 = compare.body?.data?.years?.[1];
  check("跨年对比得出「提前 6 天」", y2025?.offsetVsPrevYear === -6 && y2025?.offsetText === "提前 6 天",
    `offset=${y2025?.offsetVsPrevYear}`);

  const stats = await call(`/stats/phenology?siteId=${siteId}&speciesId=${speciesId}`, { token });
  check("物候统计返回序列", stats.status === 200 && stats.body?.data?.items?.length >= 2,
    `status=${stats.status}`);

  // 用 arrayBuffer 读取，避免 fetch 的 text() 解码时吞掉 BOM
  const csvResponse = await fetch(`${API}/export/observations?format=csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const csvBuffer = Buffer.from(await csvResponse.arrayBuffer());
  const csvText = csvBuffer.toString("utf8");
  check(
    "CSV 导出带 BOM 且包含记录",
    csvResponse.status === 200 &&
      csvBuffer[0] === 0xef &&
      csvBuffer[1] === 0xbb &&
      csvBuffer[2] === 0xbf &&
      csvText.includes("2025-03-12"),
    `status=${csvResponse.status}`,
  );

  const share = await call(`/sites/${siteId}/share`, {
    method: "POST",
    token,
    body: { scope: "TIMELINE_AND_COMPARE", expiresInDays: 7 },
  });
  check("生成分享链接", share.status === 201 && Boolean(share.body?.data?.token), `status=${share.status}`);

  const anonymous = await fetch(`${API}/share/${share.body?.data?.token}`);
  const anonymousBody = await anonymous.json();
  check("匿名访问分享页拿到只读数据", anonymous.status === 200 && anonymousBody?.data?.observations?.length === 2,
    `status=${anonymous.status}`);

  const revoke = await call(`/share-links/${share.body?.data?.id}`, { method: "DELETE", token });
  const afterRevoke = await fetch(`${API}/share/${share.body?.data?.token}`);
  check("撤销分享链接后失效", revoke.status === 200 && afterRevoke.status === 404, `status=${afterRevoke.status}`);

  // ---- 观察任务：窗口生成、幂等扫描、补录、历史、关闭 ----
  const taskCreate = await call("/tasks", {
    method: "POST",
    token,
    body: {
      title: `冒烟巡查 ${Date.now()}`,
      siteId,
      speciesId,
      phenophaseId: phase?.id,
      kind: "PLANT_PHENOLOGY",
      windowStart: "03-01",
      windowEnd: "03-31",
      timezone: "Asia/Shanghai",
      reminderDays: 3,
    },
  });
  check("创建观察任务并生成上一年/今年/下一年待办",
    taskCreate.status === 201 && taskCreate.body?.data?.instances?.length === 3,
    `status=${taskCreate.status}`);
  const taskId = taskCreate.body?.data?.id;
  const instanceYears = taskCreate.body?.data?.instances?.map((item) => item.year) ?? [];
  const currentYear = new Date().getFullYear();
  check("待办年份覆盖上一年/今年/下一年",
    instanceYears.includes(currentYear - 1) && instanceYears.includes(currentYear) && instanceYears.includes(currentYear + 1),
    `years=${instanceYears.join(",")}`);

  const scanOnce = await call("/tasks/scan", { method: "POST", token, body: {} });
  const scanTwice = await call("/tasks/scan", { method: "POST", token, body: {} });
  check("重复扫描不产生第二条待办",
    scanOnce.status === 200 && scanTwice.status === 200 &&
      scanOnce.body?.data?.instancesCreated === 0 && scanTwice.body?.data?.instancesCreated === 0);

  const currentInstance = taskCreate.body?.data?.instances?.find((item) => item.year === currentYear);
  const backfill = await call(`/tasks/instances/${currentInstance?.id}/complete`, {
    method: "POST",
    token,
    body: { observationDate: `${currentYear}-04-05` },
  });
  const backfilledInstance = backfill.body?.data?.instances?.find?.((item) => item.year === currentYear);
  check("窗口结束后登记记为逾期补录并写入逾期天数",
    backfill.status === 200 && backfilledInstance?.status === "BACKFILLED" && backfilledInstance?.completedDaysLate === 5,
    `status=${backfill.status}`);

  const events = await call(`/tasks/${taskId}/events`, { token });
  const eventTypes = events.body?.data?.map((item) => item.type) ?? [];
  check("创建与补录都留有历史",
    events.status === 200 && eventTypes.includes("CREATED") && eventTypes.includes("BACKFILLED"),
    `events=${eventTypes.join(",")}`);

  const close = await call(`/tasks/${taskId}`, { method: "DELETE", token });
  const closedList = await call("/tasks?status=CLOSED", { token });
  check("关闭任务后可在已关闭列表查到且实例/历史保留",
    close.status === 200 &&
      closedList.body?.data?.some((item) => item.id === taskId && item.instances.length === 3),
    `status=${close.status}`);

  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length) {
    console.log("失败项：");
    for (const item of failures) console.log(`  - ${item}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("冒烟测试异常：", error);
  process.exitCode = 1;
});
