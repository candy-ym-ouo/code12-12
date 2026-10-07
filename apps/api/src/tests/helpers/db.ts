import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { createApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { processImage } from "../../lib/image";
import sharp from "sharp";

export const app = createApp();

export async function resetDatabase(): Promise<void> {
  await prisma.observationTaskEvent.deleteMany();
  await prisma.observationTask.deleteMany();
  await prisma.observationTaskRule.deleteMany();
  await prisma.observationTag.deleteMany();
  await prisma.observationPhoto.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.phenophase.deleteMany();
  await prisma.species.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.site.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

export type RegisteredUser = {
  id: string;
  email: string;
  accessToken: string;
  agent: TestAgent;
};

export async function registerUser(
  overrides: Partial<{ email: string; password: string; displayName: string }> = {},
): Promise<RegisteredUser> {
  const email = overrides.email ?? `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const password = overrides.password ?? "Nature#2025";
  const displayName = overrides.displayName ?? "测试观察者";
  const agent = request.agent(app);

  const response = await agent.post("/api/v1/auth/register").send({ email, password, displayName });
  if (response.status !== 201) {
    throw new Error(`注册失败：${response.status} ${JSON.stringify(response.body)}`);
  }
  return {
    id: response.body.data.user.id,
    email,
    accessToken: response.body.data.accessToken,
    agent,
  };
}

export function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export async function createSite(userId: string, name = "测试观察点"): Promise<{ id: string; name: string }> {
  return prisma.site.create({
    data: { ownerId: userId, name, latitude: 39.9, longitude: 116.4, habitat: "城市绿地" },
    select: { id: true, name: true },
  });
}

export async function createSpeciesWithPhase(
  userId: string,
  options: { category?: string; commonName?: string; phaseName?: string; color?: string } = {},
): Promise<{ speciesId: string; phenophaseId: string }> {
  const species = await prisma.species.create({
    data: {
      ownerId: userId,
      category: options.category ?? "PLANT",
      commonName: options.commonName ?? "测试银杏",
      scientificName: "Ginkgo biloba",
      phenophases: {
        create: [
          {
            name: options.phaseName ?? "发芽",
            color: options.color ?? "#3F6F52",
            isDefault: true,
            orderIndex: 0,
          },
        ],
      },
    },
    include: { phenophases: true },
  });
  return { speciesId: species.id, phenophaseId: species.phenophases[0].id };
}

export async function createObservationViaApi(
  user: RegisteredUser,
  payload: Record<string, unknown>,
): Promise<request.Response> {
  return user.agent
    .post("/api/v1/observations")
    .set(auth(user.accessToken))
    .send(payload);
}

export async function makeJpeg(width = 640, height = 480): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 58, g: 111, b: 82 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/** 直接复用图片处理管线，用于断言算法与库行为一致。 */
export async function processTestImage(buffer: Buffer) {
  return processImage(buffer);
}
