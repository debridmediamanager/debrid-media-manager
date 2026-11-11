import { DatabaseClient } from './client';

export class SiteSettingService extends DatabaseClient {
	public async listSettings(): Promise<{ key: string; value: string }[]> {
		return this.prisma.siteSetting.findMany({ select: { key: true, value: true } });
	}

	public async setSetting(key: string, value: string): Promise<void> {
		await this.prisma.siteSetting.upsert({
			where: { key },
			create: { key, value },
			update: { value },
		});
	}

	/** Back to the environment variable. */
	public async removeSetting(key: string): Promise<void> {
		await this.prisma.siteSetting.deleteMany({ where: { key } });
	}
}
