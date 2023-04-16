import Redis from 'ioredis';

const redisOptions = {
	sentinels: [{ host: process.env.REDIS_SENTINEL_HOST, port: 26379 }],
	name: 'mymaster', // default from bitnami/redis-sentinel
	password: process.env.REDIS_PASSWORD,
};

export class RedisCache {
	private client: Redis;

	constructor() {
		this.client = new Redis(redisOptions);
	}

	public async cacheJsonValue<T>(key: string[], value: T) {
		const sortedKey = key.sort();
		const redisKey = sortedKey.join(':');
		await this.client.set(redisKey, JSON.stringify(value));
	}

	public async getCachedJsonValue<T>(key: string[]): Promise<T | undefined> {
		const sortedKey = key.sort();
		const redisKey = sortedKey.join(':');
		const jsonValue = await this.client.get(redisKey);
		if (!jsonValue) {
			return undefined;
		}
		return JSON.parse(jsonValue) as T;
	}

	public async getDbSize(): Promise<number> {
		return await this.client.dbsize();
	}
}
