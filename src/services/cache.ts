import { createClient } from 'redis';

const redisClient = createClient();
redisClient.on('error', (err) => console.error('Redis connection error', err));
redisClient.connect();

export async function cacheJsonValue<T>(key: string[], value: T) {
	const sortedKey = key.sort();
	const redisKey = sortedKey.join(':');
	const jsonValue = JSON.stringify(value);
	redisClient.SET(redisKey, jsonValue, { EX: 604800 });
}

export async function getCachedJsonValue<T>(key: string[]): Promise<T | undefined> {
	const sortedKey = key.sort();
	const redisKey = sortedKey.join(':');
	const jsonValue = await redisClient.GET(redisKey);
	if (!jsonValue) {
		return undefined;
	}
	return JSON.parse(jsonValue) as T;
}

export async function deleteCache(key: string[]): Promise<void> {
	const sortedKey = key.sort();
	const redisKey = sortedKey.join(':');
	await redisClient.DEL(redisKey);
}
