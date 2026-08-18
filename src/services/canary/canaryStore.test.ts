import { describe, expect, it } from 'vitest';
import { CanaryStore } from './canaryStore';

// No REDIS_URL is passed, so these exercise the in-memory fallback that keeps
// the tripwire working when Redis is down.
describe('CanaryStore', () => {
	const hit = { imdbId: 'tt900000123', kind: 'trap' as const, path: '/api/torrents/movie' };

	it('records a first hit', async () => {
		const store = new CanaryStore();
		await store.record('1.2.3.4', hit, 1000);

		expect(await store.get('1.2.3.4', 1000)).toEqual({
			count: 1,
			firstSeen: 1000,
			lastSeen: 1000,
			kinds: ['trap'],
			lastImdbId: 'tt900000123',
			lastPath: '/api/torrents/movie',
		});
	});

	it('accumulates repeat hits and keeps the first sighting', async () => {
		const store = new CanaryStore();
		await store.record('1.2.3.4', hit, 1000);
		await store.record(
			'1.2.3.4',
			{ imdbId: 'tt900000999', kind: 'void', path: '/api/torrents/tv' },
			5000
		);

		const record = await store.get('1.2.3.4', 5000);
		expect(record).toMatchObject({
			count: 2,
			firstSeen: 1000,
			lastSeen: 5000,
			lastImdbId: 'tt900000999',
			lastPath: '/api/torrents/tv',
		});
		expect(record?.kinds.sort()).toEqual(['trap', 'void']);
	});

	it('keeps identities separate', async () => {
		const store = new CanaryStore();
		await store.record('1.2.3.4', hit, 1000);
		await store.record('5.6.7.8', hit, 1000);

		expect((await store.get('1.2.3.4', 1000))?.count).toBe(1);
		expect((await store.get('5.6.7.8', 1000))?.count).toBe(1);
	});

	it('returns null for an identity that never tripped', async () => {
		const store = new CanaryStore();
		expect(await store.get('9.9.9.9')).toBeNull();
	});

	it('expires records after the ttl', async () => {
		const store = new CanaryStore(undefined, 60);
		await store.record('1.2.3.4', hit, 1000);

		expect(await store.get('1.2.3.4', 1000 + 59_000)).not.toBeNull();
		expect(await store.get('1.2.3.4', 1000 + 61_000)).toBeNull();
	});

	it('starts a fresh record when an expired one is hit again', async () => {
		const store = new CanaryStore(undefined, 60);
		await store.record('1.2.3.4', hit, 1000);
		await store.record('1.2.3.4', hit, 1000 + 61_000);

		expect(await store.get('1.2.3.4', 1000 + 61_000)).toMatchObject({
			count: 1,
			firstSeen: 1000 + 61_000,
		});
	});

	it('lists tripped identities', async () => {
		const store = new CanaryStore();
		await store.record('1.2.3.4', hit, 1000);
		await store.record('5.6.7.8', hit, 1000);

		const listed = await store.list(10, 1000);
		expect(listed.map((entry) => entry.identity).sort()).toEqual(['1.2.3.4', '5.6.7.8']);
	});

	it('honours the list limit', async () => {
		const store = new CanaryStore();
		for (let i = 0; i < 5; i++) {
			await store.record(`10.0.0.${i}`, hit, 1000);
		}

		expect(await store.list(2, 1000)).toHaveLength(2);
	});

	it('omits expired records from the listing', async () => {
		const store = new CanaryStore(undefined, 60);
		await store.record('1.2.3.4', hit, 1000);

		expect(await store.list(10, 1000 + 61_000)).toEqual([]);
	});
});
