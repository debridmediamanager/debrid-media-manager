import Redis from 'ioredis';

const redisOptions = {
	sentinels: [{ host: process.env.REDIS_SENTINEL_HOST, port: 26379 }],
	name: 'mymaster', // default from bitnami/redis-sentinel
	password: process.env.REDIS_PASSWORD,
};

export class RedisCache {
	private slaveClient: Redis;
	private masterClient: Redis;

	constructor() {
		this.slaveClient = new Redis({
			role: 'slave',
			reconnectOnError(err) {
				const targetError = 'READONLY';
				if (err.message.includes(targetError)) {
					return true;
				}
				return false;
			},
			...redisOptions,
		});
		this.masterClient = new Redis({
			role: 'master',
			reconnectOnError(err) {
				const targetError = 'READONLY';
				if (err.message.includes(targetError)) {
					return true;
				}
				return false;
			},
			...redisOptions,
		});
	}

	public async cacheJsonValue<T>(key: string[], value: T) {
		const sortedKey = key.sort();
		const redisKey = sortedKey.join(':');
		await this.masterClient.set(redisKey, JSON.stringify(value));
	}

	public async getCachedJsonValue<T>(key: string[]): Promise<T | undefined> {
		const sortedKey = key.sort();
		const redisKey = sortedKey.join(':');
		const jsonValue = await this.slaveClient.get(redisKey);
		if (!jsonValue) {
			return undefined;
		}
		return JSON.parse(jsonValue) as T;
	}

	public async deleteCachedJsonValue(key: string[]): Promise<void> {
		const sortedKey = key.sort();
		const redisKey = sortedKey.join(':');
		await this.masterClient.del(redisKey);
	}

	public async getDbSize(): Promise<number> {
		return await this.slaveClient.dbsize();
	}
}
