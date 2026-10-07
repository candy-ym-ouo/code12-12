/**
 * 种子脚本：写入系统预置物种库，以及在开发环境写入演示账号与跨年观测样例。
 * 使用固定 id + upsert，可重复执行。
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type PhenophaseSeed = { name: string; code?: string; color: string; isDefault?: boolean };
type SpeciesSeed = {
  id: string;
  category: "PLANT" | "INSECT" | "BIRD" | "WEATHER";
  commonName: string;
  scientificName?: string;
  family?: string;
  description?: string;
  phenophases: PhenophaseSeed[];
};

const PRESET_SPECIES: SpeciesSeed[] = [
  {
    id: "preset-ginkgo",
    category: "PLANT",
    commonName: "银杏",
    scientificName: "Ginkgo biloba",
    family: "银杏科",
    description: "落叶乔木，叶扇形，秋季变金黄。",
    phenophases: [
      { name: "芽膨大", code: "BUD_SWELL", color: "#7A9B76", isDefault: true },
      { name: "发芽", code: "BUD_BURST", color: "#3F6F52" },
      { name: "展叶", code: "LEAF_OUT", color: "#5C8F62" },
      { name: "叶变色", code: "LEAF_COLOR", color: "#B0793A" },
      { name: "落叶", code: "LEAF_FALL", color: "#8A6A4B" },
    ],
  },
  {
    id: "preset-cherry",
    category: "PLANT",
    commonName: "樱花",
    scientificName: "Cerasus spp.",
    family: "蔷薇科",
    description: "春季开花，花期短，是重要的物候指示植物。",
    phenophases: [
      { name: "花芽膨大", code: "FLOWER_BUD", color: "#C08AA0", isDefault: true },
      { name: "始花", code: "FIRST_BLOOM", color: "#C96F8E" },
      { name: "盛花", code: "FULL_BLOOM", color: "#D98BA5" },
      { name: "落花", code: "PETAL_FALL", color: "#BFA0AC" },
    ],
  },
  {
    id: "preset-magnolia",
    category: "PLANT",
    commonName: "玉兰",
    scientificName: "Yulania denudata",
    family: "木兰科",
    description: "早春先花后叶，是城市中常见的早春物候指示种。",
    phenophases: [
      { name: "花芽膨大", code: "FLOWER_BUD", color: "#A9A2C4", isDefault: true },
      { name: "始花", code: "FIRST_BLOOM", color: "#8F87B8" },
      { name: "盛花", code: "FULL_BLOOM", color: "#B7AEDA" },
      { name: "落花", code: "PETAL_FALL", color: "#9C97B3" },
    ],
  },
  {
    id: "preset-willow",
    category: "PLANT",
    commonName: "垂柳",
    scientificName: "Salix babylonica",
    family: "杨柳科",
    description: "沿水分布，早春发芽早。",
    phenophases: [
      { name: "芽膨大", code: "BUD_SWELL", color: "#7CA07C", isDefault: true },
      { name: "发芽", code: "BUD_BURST", color: "#4E8556" },
      { name: "展叶", code: "LEAF_OUT", color: "#679B62" },
    ],
  },
  {
    id: "preset-honeybee",
    category: "INSECT",
    commonName: "意大利蜜蜂",
    scientificName: "Apis mellifera ligustica",
    family: "蜜蜂科",
    description: "访花昆虫，出现时间可反映蜜源植物花期。",
    phenophases: [
      { name: "首次出巢", code: "FIRST_EMERGE", color: "#D3A33C", isDefault: true },
      { name: "访花高峰", code: "PEAK_VISIT", color: "#E0B65A" },
      { name: "活动减弱", code: "DECLINE", color: "#A98230" },
    ],
  },
  {
    id: "preset-cabbage-butterfly",
    category: "INSECT",
    commonName: "菜粉蝶",
    scientificName: "Pieris rapae",
    family: "粉蝶科",
    description: "春季常见蝴蝶，成虫出现时间年际变化明显。",
    phenophases: [
      { name: "首次羽化", code: "FIRST_EMERGE", color: "#C8CBB0", isDefault: true },
      { name: "盛发", code: "PEAK", color: "#B4B893" },
      { name: "末见", code: "LAST_SEEN", color: "#969A78" },
    ],
  },
  {
    id: "preset-barn-swallow",
    category: "BIRD",
    commonName: "家燕",
    scientificName: "Hirundo rustica",
    family: "燕科",
    description: "夏候鸟，春季到达日期是经典物候指标。",
    phenophases: [
      { name: "首次到达", code: "FIRST_ARRIVAL", color: "#3A6EA5", isDefault: true },
      { name: "筑巢", code: "NESTING", color: "#4C7FA8" },
      { name: "集群", code: "FLOCKING", color: "#6B93B5" },
      { name: "迁离", code: "DEPARTURE", color: "#2F5C86" },
    ],
  },
  {
    id: "preset-blackbird",
    category: "BIRD",
    commonName: "乌鸫",
    scientificName: "Turdus mandarinus",
    family: "鸫科",
    description: "城市常见留鸟，清晨鸣唱，春季首鸣时间可作物候参考。",
    phenophases: [
      { name: "首次鸣唱", code: "FIRST_SONG", color: "#3A6EA5", isDefault: true },
      { name: "持续鸣唱", code: "SONG_CONTINUE", color: "#5A87AE" },
      { name: "鸣唱减弱", code: "SONG_DECLINE", color: "#7C9DBA" },
    ],
  },
  {
    id: "preset-great-tit",
    category: "BIRD",
    commonName: "大山雀",
    scientificName: "Parus minor",
    family: "山雀科",
    description: "留鸟，叫声变化可记录繁殖季开始。",
    phenophases: [
      { name: "鸣唱变化", code: "SONG_CHANGE", color: "#5C7FA8", isDefault: true },
      { name: "求偶鸣唱", code: "SONG_COURTSHIP", color: "#456A94" },
    ],
  },
  {
    id: "preset-cicada",
    category: "INSECT",
    commonName: "蝉",
    scientificName: "Cicadidae spp.",
    family: "蝉科",
    description: "夏季鸣叫昆虫，首鸣日期反映夏季物候。",
    phenophases: [
      { name: "首次鸣叫", code: "FIRST_CALL", color: "#8A8F4E", isDefault: true },
      { name: "鸣叫高峰", code: "PEAK_CALL", color: "#A0A55B" },
    ],
  },
  {
    id: "preset-cold-wave",
    category: "WEATHER",
    commonName: "倒春寒",
    scientificName: undefined,
    family: undefined,
    description: "春季气温显著低于常年同期，常对早春物候造成影响。",
    phenophases: [
      { name: "降温开始", code: "COLD_START", color: "#3A6EA5", isDefault: true },
      { name: "最低温度", code: "COLD_PEAK", color: "#2F5C86" },
      { name: "气温回升", code: "COLD_END", color: "#7C9DBA" },
    ],
  },
];

type SiteSeed = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  habitat: string;
  description: string;
};

const SITES: SiteSeed[] = [
  {
    id: "seed-site-park",
    name: "城市公园北门",
    latitude: 39.9042,
    longitude: 116.4074,
    habitat: "城市绿地",
    description: "公园北门主干道两侧的行道树与花境。",
  },
  {
    id: "seed-site-ginkgo",
    name: "校园银杏道",
    latitude: 39.9891,
    longitude: 116.3158,
    habitat: "校园绿地",
    description: "长约 200 米的银杏行道树，南北向，两侧有教学楼遮挡。",
  },
  {
    id: "seed-site-wetland",
    name: "湿地观鸟栈道",
    latitude: 40.0123,
    longitude: 116.4821,
    habitat: "湿地与芦苇荡",
    description: "栈道沿线记录水鸟、鸣禽与两栖类。",
  },
];

async function upsertPresetSpecies() {
  for (const species of PRESET_SPECIES) {
    await prisma.species.upsert({
      where: { id: species.id },
      update: {
        category: species.category,
        commonName: species.commonName,
        scientificName: species.scientificName ?? null,
        family: species.family ?? null,
        description: species.description ?? null,
        isPreset: true,
      },
      create: {
        id: species.id,
        ownerId: null,
        isPreset: true,
        category: species.category,
        commonName: species.commonName,
        scientificName: species.scientificName ?? null,
        family: species.family ?? null,
        description: species.description ?? null,
      },
    });

    for (const [index, phase] of species.phenophases.entries()) {
      await prisma.phenophase.upsert({
        where: { speciesId_name: { speciesId: species.id, name: phase.name } },
        update: { orderIndex: index, color: phase.color, code: phase.code ?? null, isDefault: phase.isDefault ?? false },
        create: {
          speciesId: species.id,
          name: phase.name,
          code: phase.code ?? null,
          orderIndex: index,
          color: phase.color,
          isDefault: phase.isDefault ?? false,
        },
      });
    }
  }
  console.log(`预置物种库就绪：${PRESET_SPECIES.length} 个物种`);
}

async function seedDemoData() {
  const passwordHash = await bcrypt.hash("Nature#2025", 12);
  const user = await prisma.user.upsert({
    where: { email: "demo@nature.local" },
    update: { displayName: "演示观察者" },
    create: {
      id: "seed-user-demo",
      email: "demo@nature.local",
      passwordHash,
      displayName: "演示观察者",
      timezone: "Asia/Shanghai",
    },
  });

  for (const site of SITES) {
    await prisma.site.upsert({
      where: { id: site.id },
      update: {
        name: site.name,
        latitude: site.latitude,
        longitude: site.longitude,
        habitat: site.habitat,
        description: site.description,
      },
      create: {
        id: site.id,
        ownerId: user.id,
        name: site.name,
        latitude: site.latitude,
        longitude: site.longitude,
        habitat: site.habitat,
        description: site.description,
      },
    });
  }

  // 演示用户自己的物种库：从预置库复制银杏和乌鸫，附带物候阶段。
  const ginkgo = await prisma.species.findUniqueOrThrow({ where: { id: "preset-ginkgo" }, include: { phenophases: true } });
  const blackbird = await prisma.species.findUniqueOrThrow({ where: { id: "preset-blackbird" }, include: { phenophases: true } });

  const ownedGinkgoId = "seed-species-ginkgo";
  const ownedBlackbirdId = "seed-species-blackbird";

  for (const [speciesId, source, commonName] of [
    [ownedGinkgoId, ginkgo, ginkgo.commonName],
    [ownedBlackbirdId, blackbird, blackbird.commonName],
  ] as const) {
    await prisma.species.upsert({
      where: { id: speciesId },
      update: { commonName },
      create: {
        id: speciesId,
        ownerId: user.id,
        category: source.category,
        commonName,
        scientificName: source.scientificName,
        family: source.family,
        description: source.description,
      },
    });
    for (const phase of source.phenophases) {
      await prisma.phenophase.upsert({
        where: { speciesId_name: { speciesId, name: phase.name } },
        update: { orderIndex: phase.orderIndex, color: phase.color, code: phase.code, isDefault: phase.isDefault },
        create: {
          speciesId,
          name: phase.name,
          code: phase.code,
          orderIndex: phase.orderIndex,
          color: phase.color,
          isDefault: phase.isDefault,
        },
      });
    }
  }

  const budding = await prisma.phenophase.findUniqueOrThrow({
    where: { speciesId_name: { speciesId: ownedGinkgoId, name: "发芽" } },
  });
  const firstSong = await prisma.phenophase.findUniqueOrThrow({
    where: { speciesId_name: { speciesId: ownedBlackbirdId, name: "首次鸣唱" } },
  });

  const observations = [
    {
      id: "seed-obs-ginkgo-2023",
      speciesId: ownedGinkgoId,
      phenophaseId: budding.id,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2023-03-20",
      title: "银杏发芽（2023）",
      notes: "芽鳞裂开，约四分之一芽显绿。",
      temperatureC: 11.5,
    },
    {
      id: "seed-obs-ginkgo-2024",
      speciesId: ownedGinkgoId,
      phenophaseId: budding.id,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2024-03-18",
      title: "银杏发芽（2024）",
      notes: "芽鳞微裂，仅少量芽尖露绿。",
      temperatureC: 10.2,
    },
    {
      id: "seed-obs-ginkgo-2025",
      speciesId: ownedGinkgoId,
      phenophaseId: budding.id,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-03-12",
      title: "银杏发芽（2025）",
      notes: "约三分之一芽已显绿，比往年明显提前。",
      temperatureC: 12.8,
    },
    {
      id: "seed-obs-blackbird-2024",
      speciesId: ownedBlackbirdId,
      phenophaseId: firstSong.id,
      kind: "BIRD_SOUND",
      observationDate: "2024-03-05",
      title: "乌鸫首次鸣唱（2024）",
      notes: "清晨 6:10 听到完整鸣唱段落。",
      temperatureC: 8.4,
    },
    {
      id: "seed-obs-blackbird-2025",
      speciesId: ownedBlackbirdId,
      phenophaseId: firstSong.id,
      kind: "BIRD_SOUND",
      observationDate: "2025-03-01",
      title: "乌鸫首次鸣唱（2025）",
      notes: "清晨 5:58 听到连续鸣唱。",
      temperatureC: 9.1,
    },
    {
      id: "seed-obs-coldwave-2025",
      speciesId: null,
      phenophaseId: null,
      kind: "WEATHER_ANOMALY",
      observationDate: "2025-04-09",
      title: "倒春寒",
      notes: "48 小时内降温 9℃，清晨出现霜冻。",
      temperatureC: 1.2,
      precipitationMm: 0,
      windLevel: 4,
      anomalyType: "LATE_FROST",
      anomalySeverity: "MODERATE",
      impactNotes: "银杏新叶边缘轻微冻伤，早开樱花花瓣受损。",
    },
  ] as const;

  for (const item of observations) {
    await prisma.observation.upsert({
      where: { id: item.id },
      update: {
        observationDate: item.observationDate,
        title: item.title,
        notes: item.notes,
        temperatureC: item.temperatureC,
      },
      create: {
        id: item.id,
        ownerId: user.id,
        siteId: "seed-site-ginkgo",
        speciesId: item.speciesId,
        phenophaseId: item.phenophaseId,
        kind: item.kind,
        status: "PUBLISHED",
        observationDate: item.observationDate,
        title: item.title,
        notes: item.notes,
        temperatureC: item.temperatureC,
        precipitationMm: "precipitationMm" in item ? item.precipitationMm : null,
        windLevel: "windLevel" in item ? item.windLevel : null,
        anomalyType: "anomalyType" in item ? item.anomalyType : null,
        anomalySeverity: "anomalySeverity" in item ? item.anomalySeverity : null,
        impactNotes: "impactNotes" in item ? item.impactNotes : null,
      },
    });
  }

  // 一条覆盖当前演示日期（10 月上旬）的观察计划，扫描后待办页立即可见
  await prisma.observationTaskRule.upsert({
    where: { id: "seed-rule-ginkgo-autumn" },
    update: {
      name: "银杏叶始变色观察",
      windowStartMd: "10-01",
      windowEndMd: "11-15",
      dueOffsetDays: 5,
      remindBeforeDays: 3,
      active: true,
    },
    create: {
      id: "seed-rule-ginkgo-autumn",
      ownerId: user.id,
      siteId: "seed-site-ginkgo",
      speciesId: ownedGinkgoId,
      phenophaseId: budding.id,
      name: "银杏叶始变色观察",
      kind: "PLANT_PHENOLOGY",
      windowStartMd: "10-01",
      windowEndMd: "11-15",
      dueOffsetDays: 5,
      remindBeforeDays: 3,
      active: true,
    },
  });

  console.log(`演示数据就绪：${user.email} / Nature#2025，${SITES.length} 个地点，${observations.length} 条观测`);
}

async function main() {
  await upsertPresetSpecies();

  const isProduction = process.env.NODE_ENV === "production";
  const force = process.env.FORCE_SEED === "1";
  if (isProduction && !force) {
    console.log("生产环境默认跳过演示数据（如需写入请设置 FORCE_SEED=1）");
    return;
  }
  await seedDemoData();
}

main()
  .catch((error) => {
    console.error("种子脚本执行失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
