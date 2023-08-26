import { PrismaClient } from '@prisma/client';

export class PlanetScaleCache {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  public async cacheJsonValue<T>(key: string[], value: T) {
    const sortedKey = key.sort();
    const planetScaleKey = sortedKey.join(':');

    const counter = await this.prisma.counter.findUnique({ where: { id: 'cache' } });

    await this.prisma.$transaction([
      this.prisma.cache.upsert({
        where: { key: planetScaleKey },
        update: { value },
        create: { key: planetScaleKey, value },
      }),
      this.prisma.counter.update({
        where: { id: 'cache' },
        data: { count: (counter?.count || 0) + 1 },
      }),
    ]);
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

    const counter = await this.prisma.counter.findUnique({ where: { id: 'cache' } });

    await this.prisma.$transaction([
      this.prisma.cache.delete({ where: { key: planetScaleKey } }),
      this.prisma.counter.update({
        where: { id: 'cache' },
        data: { count: (counter?.count || 0) - 1 },
      }),
    ]);
  }

  public async getDbSize(): Promise<number> {
    const counter = await this.prisma.counter.findUnique({ where: { id: 'cache' } });
    return counter?.count || 0;
  }
}
