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

  ///

  public async saveScrapedResults<T>(key: string, value: T) {
    await this.prisma.scraped.upsert({
      where: { key },
      update: { value } as any,
      create: { key, value } as any,
    });
  }

  public async getScrapedResults<T>(key: string): Promise<T | undefined> {
    const cacheEntry = await this.prisma.scraped.findUnique({ where: { key } });
    return cacheEntry?.value as T | undefined;
  }

  public async getScrapedDbSize(): Promise<number> {
    const count = await this.prisma.scraped.count();
    return count;
  }

  public async keyExists(key: string): Promise<boolean> {
    const cacheEntry = await this.prisma.scraped.findFirst({
      where: { key },
      select: { key: true },
    });
    return cacheEntry !== null;
  }

}
