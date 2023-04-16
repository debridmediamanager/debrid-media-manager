import { createClient, RedisClientType } from 'redis';

const sentinels = [
	{ host: 'redis-sentinel', port: 26379 },
];

const redisOptions = {
	sentinels: sentinels,
	name: 'mymaster',
};

export class RedisCache {
	private client: RedisClientType;

	constructor() {
		this.client = createClient(redisOptions);
		this.client.on('error', this.handleRedisConnectionError.bind(this));
		this.client.connect();
	}

	private handleRedisConnectionError(err: any) {
		console.error('Redis connection error', err);
		if (err.code === 'ECONNREFUSED') {
			this.client.quit();
			this.client = createClient(redisOptions);
			this.client.on('error', this.handleRedisConnectionError.bind(this));
			this.client.connect();
		}
	}

	public async cacheJsonValue<T>(key: string[], value: T) {
		const sortedKey = key.sort();
		const redisKey = sortedKey.join(':');
		try {
			this.client.SET(redisKey, JSON.stringify(value));
		} catch (err: any) {
			if (err.code === 'ECONNREFUSED') {
				const jitter = Math.floor(Math.random() * 500) + 500;
				await new Promise((resolve) => setTimeout(resolve, jitter));
				await this.cacheJsonValue(key, value);
			}
		}
	}

	public async getCachedJsonValue<T>(key: string[]): Promise<T | undefined> {
		const sortedKey = key.sort();
		const redisKey = sortedKey.join(':');
		try {
			const jsonValue = await this.client.GET(redisKey);
			if (!jsonValue) {
				return undefined;
			}
			return JSON.parse(jsonValue) as T;
		} catch (err: any) {
			if (err.code === 'ECONNREFUSED') {
				const jitter = Math.floor(Math.random() * 500) + 500;
				await new Promise((resolve) => setTimeout(resolve, jitter));
				return await this.getCachedJsonValue(key);
			}
		}
	}
}
