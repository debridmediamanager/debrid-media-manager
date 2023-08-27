import { PrismaClient } from '@prisma/client';

export class PlanetScaleCache {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
    this.prisma.$queryRaw`SET @@boost_cached_queries = true`
  }

  public async cacheJsonValue<T>(key: string[], value: T) {
    const sortedKey = key.sort();
    const planetScaleKey = sortedKey.join(':');

    await this.prisma.cache.upsert({
      where: { key: planetScaleKey },
      update: { value } as any,
      create: { key: planetScaleKey, value } as any,
    });
  }

  public async getCachedJsonValue<T>(key: string[]): Promise<T | undefined> {
    const sortedKey = key.sort();
    const planetScaleKey = sortedKey.join(':');

    const cacheEntry = await this.prisma.cache.findUnique({ where: { key: planetScaleKey } });
    return cacheEntry?.value as T | undefined;
  }

  public async deleteCachedJsonValue(key: string[]): Promise<void> {
    const sortedKey = key.sort();
    const planetScaleKey = sortedKey.join(':');

    await this.prisma.cache.delete({ where: { key: planetScaleKey } });
  }

  public async getDbSize(): Promise<number> {
    const count = await this.prisma.cache.count();
    return count;
  }
}
